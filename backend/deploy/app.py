"""Development deployment entrypoint; product collection remains disabled."""

from app.analysis import ReferenceAnalysisService, ResourceUnavailable, load_resources
from app.contract.services import NullLearningSink
from app.main import create_app

try:
    resources = load_resources()
except ResourceUnavailable:
    resources = None

app = create_app(
    analysis_service=ReferenceAnalysisService(resources),
    learning_sink=NullLearningSink(),
)
