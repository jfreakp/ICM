import time

import jwt
import pytest

from app.auth import create_access_token, decode_access_token, hash_password, verify_password
from app.config import settings


def test_hash_password_produces_different_hash_than_input():
    hashed = hash_password("correct horse battery staple")
    assert hashed != "correct horse battery staple"


def test_verify_password_accepts_correct_password():
    hashed = hash_password("correct horse battery staple")
    assert verify_password("correct horse battery staple", hashed) is True


def test_verify_password_rejects_wrong_password():
    hashed = hash_password("correct horse battery staple")
    assert verify_password("wrong password", hashed) is False


def test_create_access_token_contains_user_id_and_email():
    token = create_access_token(user_id=42, email="user@example.com")
    payload = decode_access_token(token)
    assert payload["sub"] == "42"
    assert payload["email"] == "user@example.com"


def test_decode_access_token_rejects_tampered_token():
    token = create_access_token(user_id=42, email="user@example.com")
    tampered = token[:-1] + ("A" if token[-1] != "A" else "B")
    with pytest.raises(jwt.InvalidTokenError):
        decode_access_token(tampered)


def test_decode_access_token_rejects_expired_token():
    expired_payload = {
        "sub": "42",
        "email": "user@example.com",
        "exp": int(time.time()) - 10,
    }
    expired_token = jwt.encode(expired_payload, settings.jwt_secret, algorithm="HS256")
    with pytest.raises(jwt.InvalidTokenError):
        decode_access_token(expired_token)


def test_verify_password_returns_false_for_overlong_password():
    hashed = hash_password("short-password")
    assert verify_password("x" * 100, hashed) is False


def test_hash_and_verify_password_stay_consistent_for_passwords_over_72_bytes():
    long_password = "ñ" * 72  # 72 chars, 144 bytes
    hashed = hash_password(long_password)
    assert verify_password(long_password, hashed) is True
    # Differ on the first character (byte offset 0) so the difference falls
    # inside the 72-byte truncation window. Note: differing only on the last
    # character would NOT work here, since "ñ" is 2 bytes and 72 is evenly
    # divisible by 2 — a change at char 72 lands at byte offset 142, past the
    # 72-byte boundary, so both strings would truncate identically.
    assert verify_password("x" + "ñ" * 71, hashed) is False
