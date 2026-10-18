"""Keep database imports out of the base API/health no-driver test process."""

import os

collect_ignore = [] if os.environ.get("BE13_ISOLATED_CHILD") == "1" else ["cases"]
