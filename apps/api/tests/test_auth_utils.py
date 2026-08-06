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
