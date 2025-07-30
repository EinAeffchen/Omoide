from abc import ABC, abstractmethod
from sqlmodel import Session
from app.models import Media, Scene
from cv2.typing import MatLike
from PIL.ImageFile import ImageFile


class MediaProcessor(ABC):
    """
    A piece of logic that, given a Media row,
    may insert or update other tables to enrich it.
    """
    name: str   #unique key, e.g. "exif" or "face_extraction"
    active: bool = False
    order: int = -1 # order in which to run processors
    @abstractmethod
    def load_model(self):
        """Used to load models into memory before use"""

    @abstractmethod
    def unload(self):
        """Used to load models into memory before use"""

    @abstractmethod
    def process(
        self,
        media: Media,
        session: Session,
        scenes: list[tuple[Scene, MatLike]] | list[ImageFile] | list[Scene],
    ) -> bool|None:
        """
        Called once for each new or updated Media.
        Should commit its own changes (e.g. write to its own tables).
        """

    def get_results(self, media_id: int, session: Session):
        """
        Return something JSON‑serializable about this media.
        Default: empty dict.
        Override in subclasses to return meaningful data.
        """
        return {}
