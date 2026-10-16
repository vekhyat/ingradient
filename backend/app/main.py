"""FastAPI application factory for the local analysis API."""

from fastapi import FastAPI

from app.api.analyses import create_analyses_router
from app.api.problems import install_problem_handlers
from app.contract.limits import AnalysisRateLimiter, RateLimiter
from app.contract.services import (
    AnalysisService,
    LearningSink,
    NamedGapAnalysisService,
    NullLearningSink,
)
from app.health import create_health_router, read_contract_version
from app.logging import RequestCompletedLogMiddleware, configure_logging
from app.settings import Settings


def create_app(
    settings: Settings | None = None,
    *,
    analysis_service: AnalysisService | None = None,
    learning_sink: LearningSink | None = None,
    rate_limiter: RateLimiter | None = None,
) -> FastAPI:
    """Build the app. The contract version is loaded before the app serves.

    The analysis service and learning sink default to a named gap and a sink
    that stores nothing. Collection stays off until a later task replaces the
    sink. No database URL is read here.
    """

    resolved = settings if settings is not None else Settings()
    logger = configure_logging(resolved.log_level)
    contract_version = read_contract_version()
    # Signals stay off until a reviewed exporter exists. A global provider would
    # otherwise record query strings on spans.
    app = FastAPI(
        title="Ingradient",
        version=contract_version,
        telemetry={"tracing": False, "metrics": False, "logs": False},
    )
    app.state.analysis_service = (
        analysis_service if analysis_service is not None else NamedGapAnalysisService()
    )
    app.state.learning_sink = (
        learning_sink if learning_sink is not None else NullLearningSink()
    )
    app.state.rate_limiter = (
        rate_limiter if rate_limiter is not None else AnalysisRateLimiter()
    )
    install_problem_handlers(app)
    app.add_middleware(RequestCompletedLogMiddleware)
    app.include_router(create_health_router(contract_version))
    app.include_router(create_analyses_router(contract_version))
    logger.info(
        "application ready environment=%s log_level=%s",
        resolved.env,
        resolved.log_level,
    )
    return app


app = create_app()
