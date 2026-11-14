#!/usr/bin/env python3
"""Entry point for the 3X-UI Inbound Manager."""
import uvicorn
import logging
from app.config import load_settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

if __name__ == "__main__":
    settings = load_settings()
    port = int(settings.get("port", 8181))
    
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=port,
        reload=False,
        log_level="info",
    )
