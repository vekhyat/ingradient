"""SHA-256 of RFC 8785 canonical JSON.

The caller must pass the product object returned by the JSON parser, before
Pydantic fills defaults. A missing field and a null field are different
values, and they must stay different in this hash.
"""

import hashlib
from typing import Any, cast

from rfc8785 import dumps


def input_digest(value: object) -> str:
    """Lowercase hex SHA-256 of the canonical JSON of ``value``."""

    # dumps accepts JSON values. Its recursive alias is not a public type.
    canonical = dumps(cast(Any, value))
    return hashlib.sha256(canonical).hexdigest()
