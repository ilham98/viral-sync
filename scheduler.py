import os
import schedule
import time
import logging
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from dotenv import load_dotenv
from fetcher import send_request

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("scheduler.log"),
    ],
)

_sync_lock = threading.Lock()


class TriggerHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/trigger":
            self.send_response(404)
            self.end_headers()
            return

        if not _sync_lock.acquire(blocking=False):
            self.send_response(409)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"error":"sync already in progress"}')
            return

        def run():
            try:
                send_request()
            finally:
                _sync_lock.release()

        threading.Thread(target=run, daemon=True).start()
        self.send_response(202)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def log_message(self, fmt, *args):
        logging.info("TriggerServer: " + fmt, *args)


def start_trigger_server():
    port = int(os.getenv("TRIGGER_PORT", "5050"))
    server = ThreadingHTTPServer(("0.0.0.0", port), TriggerHandler)
    logging.info("Trigger HTTP server listening on port %d", port)
    server.serve_forever()


SCHEDULED_TIMES = ["08:00", "18:00", "20:00", "21:00", "22:00"]


def main():
    threading.Thread(target=start_trigger_server, daemon=True).start()

    logging.info("Scheduler started — daily runs at: %s", ", ".join(SCHEDULED_TIMES))

    for t in SCHEDULED_TIMES:
        schedule.every().day.at(t).do(send_request)

    while True:
        schedule.run_pending()
        time.sleep(1)


if __name__ == "__main__":
    main()