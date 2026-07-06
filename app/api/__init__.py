from .media import router as media
from .person import router as person
from .tasks import router as tasks
from .face import router as face
from .tags import router as tags
from .search import router as search
from .duplicates import router as duplicates
from .config import router as config
from .missing import router as missing
from .nopersons import router as nopersons
from .untagged import router as untagged
from .shortvideos import router as shortvideos
from .lowresolution import router as lowresolution
from .noexifdate import router as noexifdate
from .memories import router as memories
from .stats import router as stats
from .albums import router as albums
from .events import router as events
from .places import router as places

__all__ = ["media", "person", "tasks", "face", "tags", "search", "duplicates", "config", "missing", "nopersons", "untagged", "shortvideos", "lowresolution", "noexifdate", "memories", "stats", "albums", "events", "places"]
