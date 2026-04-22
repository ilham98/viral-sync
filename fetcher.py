import os
import re
import time
import logging
import requests
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

LOGIN_URL = "https://viral.pupuk-indonesia.com/User/login"
LOGIN_PAGE_URL = "https://viral.pupuk-indonesia.com/index.php/welcome/index"
DASHBOARD_URL = "https://viral.pupuk-indonesia.com/strava/dashboard_individu_pi23"
POST_URL = "https://viral.pupuk-indonesia.com/Strava/processStravaKeyActivityParamsAjaxUser"

USERNAME = os.getenv("VIRAL_USERNAME")
PASSWORD = os.getenv("VIRAL_PASSWORD")
INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY", "change-this-to-a-random-api-key")
BACKEND_BASE_URL = os.getenv("BACKEND_BASE_URL", "http://localhost:1997")

MAX_RETRIES = 3
RETRY_DELAY_SECONDS = 10

BASE_HEADERS = {
    "Accept-Language": "en-US,en;q=0.9,my;q=0.8,eo;q=0.7,ms;q=0.6,zh-CN;q=0.5,zh;q=0.4",
    "Connection": "keep-alive",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
    "sec-ch-ua": '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
}

logger = logging.getLogger(__name__)


def _log_sync_start(athlete_id: str, sync_date: str) -> int | None:
    """Insert an in_progress record; returns the new row id or None on failure."""
    try:
        resp = requests.post(
            f"{BACKEND_BASE_URL}/api/sync/log",
            headers={"x-api-key": INTERNAL_API_KEY, "Content-Type": "application/json"},
            json={"athlete_id": athlete_id, "sync_date": sync_date, "status": "in_progress", "response": None},
            timeout=10,
        )
        if resp.ok:
            return resp.json().get("id")
    except Exception as exc:
        logger.warning("Could not log sync start to backend: %s", exc)
    return None


def _log_sync_update(record_id: int | None, status: str, response: str | None) -> None:
    """Update an existing sync_history row with the final status/response."""
    if record_id is None:
        return
    try:
        requests.patch(
            f"{BACKEND_BASE_URL}/api/sync/log/{record_id}",
            headers={"x-api-key": INTERNAL_API_KEY, "Content-Type": "application/json"},
            json={"status": status, "response": response},
            timeout=10,
        )
    except Exception as exc:
        logger.warning("Could not update sync log in backend: %s", exc)


def get_athletes() -> list[dict]:
    """Fetch active athletes from the backend API. Falls back to ATHLETE_ID env var."""
    try:
        resp = requests.get(
            f"{BACKEND_BASE_URL}/api/athletes",
            headers={"x-api-key": INTERNAL_API_KEY},
            timeout=10,
        )
        if resp.ok:
            athletes = resp.json()
            if athletes:
                logger.info("Fetched %d athlete(s) from backend", len(athletes))
                return athletes
    except Exception as exc:
        logger.warning("Could not fetch athletes from backend: %s", exc)

    fallback = os.getenv("ATHLETE_ID", "123317248")
    logger.info("Using fallback athlete ID: %s", fallback)
    return [{"athlete_id": fallback, "label": "fallback"}]


def _scrape_csrf(html: str, session: requests.Session, cookie_name: str = "csrf_cookie_name") -> str | None:
    """Extract CSRF token from cookie jar or hidden input field."""
    token = session.cookies.get(cookie_name)
    if token:
        return token
    match = re.search(
        r'<input[^>]+name=["\']csrf_test_name["\'][^>]+value=["\']([^"\']+)["\']',
        html,
    )
    return match.group(1) if match else None


def login(session: requests.Session) -> bool:
    """
    Load the login page to get a CSRF token, then POST credentials.
    Returns True if login succeeded (redirected away from login page).
    """
    resp = session.get(
        LOGIN_PAGE_URL,
        headers={**BASE_HEADERS, "Accept": "text/html,application/xhtml+xml,*/*"},
        timeout=30,
    )
    resp.raise_for_status()

    csrf_token = _scrape_csrf(resp.text, session)
    if not csrf_token:
        logger.error("Could not find CSRF token on login page")
        return False

    payload = {
        "csrf_test_name": csrf_token,
        "device_id": "",
        "username": USERNAME,
        "password": PASSWORD,
    }

    resp = session.post(
        LOGIN_URL,
        headers={
            **BASE_HEADERS,
            "Accept": "text/html,application/xhtml+xml,*/*",
            "Content-Type": "application/x-www-form-urlencoded",
            "Origin": "https://viral.pupuk-indonesia.com",
            "Referer": LOGIN_PAGE_URL,
        },
        data=payload,
        timeout=30,
        allow_redirects=True,
    )
    resp.raise_for_status()

    # Server returns home page content on success without changing the URL.
    # Check for login form still being present to detect failure.
    if 'action="https://viral.pupuk-indonesia.com/User/login"' in resp.text:
        logger.error("Login failed — credentials rejected")
        return False

    logger.info("Login successful")
    return True


def fetch_csrf_token(session: requests.Session) -> str | None:
    """
    Load the dashboard page so the server sets a fresh CSRF cookie,
    then return the token value.
    Falls back to scraping a hidden input field if the cookie is absent.
    """
    resp = session.get(
        DASHBOARD_URL,
        headers={**BASE_HEADERS, "Accept": "text/html,application/xhtml+xml,*/*"},
        timeout=30,
    )
    resp.raise_for_status()

    token = _scrape_csrf(resp.text, session)
    if token:
        logger.info("CSRF token obtained: %s", token)
        return token

    logger.error("Could not find CSRF token in cookies or HTML")
    return None


def _sync_one(
    session: requests.Session,
    csrf_token: str,
    athlete_id: str,
    today: str,
    today_iso: str,
) -> bool:
    payload = {
        "data": (
            f"csrf_test_name={csrf_token}"
            f"&tanggalrefresh={today}"
            f"&athlete_id3={athlete_id}"
        ),
        "csrf_test_name": csrf_token,
    }
    try:
        response = session.post(
            POST_URL,
            headers={
                **BASE_HEADERS,
                "Accept": "application/json, text/javascript, */*; q=0.01",
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "Origin": "https://viral.pupuk-indonesia.com",
                "Referer": DASHBOARD_URL,
                "Sec-Fetch-Dest": "empty",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "same-origin",
                "X-Requested-With": "XMLHttpRequest",
            },
            data=payload,
            timeout=30,
        )
        result_text = response.text[:500]
        status = "success" if response.ok else "failed"
        logger.info(
            "Athlete %s | http=%s | date=%s | response=%s",
            athlete_id, response.status_code, today, result_text,
        )
        _log_sync(athlete_id, today_iso, status, result_text)
        return response.ok
    except requests.RequestException as e:
        logger.error("Athlete %s | Request failed: %s", athlete_id, e)
        _log_sync(athlete_id, today_iso, "failed", str(e))
        return False


def send_request() -> bool:
    """Login once, then sync every configured athlete."""
    today = datetime.now().strftime("%d-%m-%Y")
    today_iso = datetime.now().strftime("%Y-%m-%d")

    athletes = get_athletes()
    if not athletes:
        logger.error("No athletes configured")
        return False

    logger.info("Syncing %d athlete(s)...", len(athletes))

    with requests.Session() as session:
        if not login(session):
            for a in athletes:
                _log_sync(a["athlete_id"], today_iso, "failed", "Login failed")
            return False

        csrf_token = fetch_csrf_token(session)
        if not csrf_token:
            logger.error("Skipping — no CSRF token available")
            for a in athletes:
                _log_sync(a["athlete_id"], today_iso, "failed", "No CSRF token")
            return False

        results = []
        for a in athletes:
            athlete_id = a["athlete_id"]
            success = False
            for attempt in range(1, MAX_RETRIES + 1):
                if attempt > 1:
                    logger.info(
                        "Athlete %s | retry %d/%d — waiting %ds...",
                        athlete_id, attempt, MAX_RETRIES, RETRY_DELAY_SECONDS,
                    )
                    time.sleep(RETRY_DELAY_SECONDS)
                success = _sync_one(session, csrf_token, athlete_id, today, today_iso)
                if success:
                    break
            results.append(success)

    return all(results)


if __name__ == "__main__":
    # Quick test: run once and print result
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )
    success = send_request()
    print("Result:", "OK" if success else "FAILED")
