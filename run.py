#!/usr/bin/env python3
"""Entry point for the 3X-UI Inbound Manager."""
import uvicorn
import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8181,
        reload=False,
        log_level="info",
    )
