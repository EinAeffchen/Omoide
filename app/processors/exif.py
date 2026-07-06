import re
from pathlib import Path
from datetime import datetime
from PIL import ExifTags, ImageFile
from sqlmodel import select
from app.processors.base import MediaProcessor
from app.models import Media, ExifData, Scene
from app.config import settings
from cv2.typing import MatLike
from PIL.MpoImagePlugin import MpoImageFile
from app.database import safe_commit
from sqlalchemy.orm import Session
import ffmpeg

from dateutil import parser
from app.logger import logger
import traceback


def _decode_bytes(val: bytes) -> str:
    try:
        return val.rstrip(b"\x00").decode("utf-8", "ignore")
    except Exception as e:
        logger.error("FAILED DECODING BYTES: %s", e)
        return val.decode("latin1", "ignore")


def _to_decimal(coord, ref):
    d, m, s = coord
    dec = float(d) + float(m) / 60 + float(s) / 3600
    if isinstance(ref, bytes):
        ref = _decode_bytes(ref)
    return dec if ref in ("N", "E") else -dec


# ISO 6709 point coordinates, e.g. "+52.5200+013.4050+034.000/" (Android
# `location` tag and Apple `com.apple.quicktime.location.ISO6709`).
_ISO6709_RE = re.compile(r"^(?P<lat>[+-]\d+(?:\.\d+)?)(?P<lon>[+-]\d+(?:\.\d+)?)")


def _parse_iso6709(value: str) -> tuple[float | None, float | None]:
    match = _ISO6709_RE.match(value.strip())
    if not match:
        return None, None
    try:
        return float(match.group("lat")), float(match.group("lon"))
    except ValueError:
        return None, None


def _read_image_exif(img) -> tuple[dict, dict]:
    """Return ({tag name: value}, raw GPS IFD) for an open image.

    Uses the modern Exif API, which works for every PIL plugin (including
    pillow_heif's HEIC/HEIF), falling back to the legacy _getexif() that only
    the JPEG/TIFF plugins implement.
    """
    named: dict = {}
    gps_raw: dict = {}
    try:
        exif = img.getexif()
    except Exception:
        exif = None
    if exif:
        merged = dict(exif)
        try:
            merged.update(exif.get_ifd(ExifTags.IFD.Exif))
        except Exception:
            pass
        for tag_id, val in merged.items():
            tag = ExifTags.TAGS.get(tag_id, tag_id)
            if isinstance(val, bytes):
                val = _decode_bytes(val)
            named[tag] = val
        try:
            gps_raw = dict(exif.get_ifd(ExifTags.IFD.GPSInfo))
        except Exception:
            gps_raw = {}
    if not named:
        try:
            raw = img._getexif() or {}
        except (AttributeError, SyntaxError):
            raw = {}
        for tag_id, val in raw.items():
            tag = ExifTags.TAGS.get(tag_id, tag_id)
            if isinstance(val, bytes):
                val = _decode_bytes(val)
            named[tag] = val
        gps = raw.get(34853)
        if isinstance(gps, dict):
            gps_raw = gps
    return named, gps_raw


class ExifProcessor(MediaProcessor):
    name = "exif"
    order = 0
    # Videos are probed via ffmpeg directly and images that produced no scenes
    # still need their marker row, so scene extraction results are optional.
    handles_empty_scenes = True

    def _process_image(
        self, img: MpoImageFile, session: Session, media: Media
    ):
        try:
            exif, gps = _read_image_exif(img)

            make = exif.get("Make")
            model = exif.get("Model")
            dt = exif.get("DateTimeOriginal") or exif.get("DateTime")
            timestamp = None
            if dt:
                try:
                    timestamp = datetime.strptime(
                        str(dt), "%Y:%m:%d %H:%M:%S"
                    )
                except ValueError:
                    logger.debug(
                        "Invalid EXIF date for %s: %s", media.path, dt
                    )

            iso = exif.get("ISOSpeedRatings")
            exp = exif.get("ExposureTime")  # might be a Fraction
            exposure_time = str(exp) if exp else None

            fnum = exif.get("FNumber")
            aperture = f"F{float(fnum):.1f}" if fnum else None

            foc35 = exif.get("FocalLengthIn35mmFilm")
            focal_length = float(foc35) if foc35 else None

            lat = lon = None
            if gps:
                decoded = {
                    ExifTags.GPSTAGS.get(k, k): v for k, v in gps.items()
                }
                lat_val = decoded.get("GPSLatitude")
                lat_ref = decoded.get("GPSLatitudeRef")
                lon_val = decoded.get("GPSLongitude")
                lon_ref = decoded.get("GPSLongitudeRef")
                if lat_val and lat_ref:
                    lat = _to_decimal(lat_val, lat_ref)
                if lon_val and lon_ref:
                    lon = _to_decimal(lon_val, lon_ref)

            rec = ExifData(
                media_id=media.id,
                make=make,
                model=model,
                timestamp=timestamp,
                iso=int(iso) if iso else None,
                exposure_time=exposure_time,
                aperture=aperture,
                focal_length=focal_length,
                lat=lat,
                lon=lon,
            )
            session.add(rec)
            safe_commit(session)

        except Exception as e:
            logger.error("EXIF FAILED: %s", e)
            pass

    def _process_video(self, media: Media, session: Session):
        try:
            video_meta = ffmpeg.probe(media.path)
            tags = video_meta.get("format", {}).get("tags", {})
            if not tags:
                return

            location_data = tags.get("location") or tags.get(
                "com.apple.quicktime.location.ISO6709", ""
            )
            if location_data:
                lat, lon = _parse_iso6709(location_data)
            else:
                lat, lon = None, None
            timestamp = tags.get("creation_time")
            if timestamp:
                timestamp = parser.parse(timestamp)
            model = (
                tags.get("com.android.manufacturer", "")
                + tags.get("com.android.model", "").strip()
            ) or tags.get("com.apple.quicktime.model", "").strip()
            rec = ExifData(
                media_id=media.id,
                model=model,
                timestamp=timestamp,
                lat=lat,
                lon=lon,
            )
            session.add(rec)
            safe_commit(session)
        except Exception as e:
            logger.error(e)
            logger.error(traceback.format_exc())

    def _has_record(self, media_id: int, session: Session) -> bool:
        return (
            session.exec(
                select(ExifData).where(ExifData.media_id == media_id)
            ).first()
            is not None
        )

    def process(
        self,
        media: Media,
        session,
        scenes: list[tuple[Scene, MatLike]] | list[ImageFile] | list[Scene],
    ):
        if self._has_record(media.id, session):
            return True

        fn = Path(media.filename)
        suffix = fn.suffix.lower()
        if suffix in settings.scan.IMAGE_SUFFIXES:
            if scenes:
                self._process_image(scenes[0], session, media)
        elif suffix in settings.scan.VIDEO_SUFFIXES:
            self._process_video(media, session)
        if not self._has_record(media.id, session):
            # Leave an empty marker row when nothing could be extracted, so
            # get_pending_condition() (row absence) treats this media as done
            # instead of retrying it forever.
            session.add(ExifData(media_id=media.id))
            safe_commit(session)
        return True

    def get_pending_condition(self):
        return Media.id.not_in(select(ExifData.media_id))

    def reset_for_media(self, media: Media, session: Session) -> None:
        existing = session.exec(
            select(ExifData).where(ExifData.media_id == media.id)
        ).first()
        if existing:
            session.delete(existing)

    def load_model(self):
        """Doesn't need a model"""
        if settings.processors.exif_processor_active:
            self.active = True

    def unload(self):
        """Doesn't need a model"""

    def get_results(self, media_id: int, session):
        return session.exec(
            select(ExifData).where(ExifData.media_id == media_id)
        ).first()
