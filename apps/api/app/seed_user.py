import argparse
import asyncio

from sqlalchemy import select

from app.auth import hash_password
from app.database import async_session_maker
from app.models import User


async def create_user(email: str, password: str, full_name: str) -> None:
    email = email.lower()
    async with async_session_maker() as session:
        existing = await session.scalar(select(User).where(User.email == email))
        if existing is not None:
            print(f"User {email} already exists (id={existing.id}), skipping.")
            return
        user = User(email=email, password_hash=hash_password(password), full_name=full_name)
        session.add(user)
        await session.commit()
        print(f"Created user {email} (id={user.id}).")


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a user in app.users")
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--full-name", required=True)
    args = parser.parse_args()
    asyncio.run(create_user(args.email, args.password, args.full_name))


if __name__ == "__main__":
    main()
