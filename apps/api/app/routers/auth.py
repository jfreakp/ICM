import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import registrar_evento
from app.auth import create_access_token, decode_access_token, hash_password, verify_password
from app.database import get_db
from app.models import User
from app.schemas import (
    ChangeOwnPasswordRequest,
    CreateUserRequest,
    LoginRequest,
    ResetPasswordRequest,
    TokenResponse,
    UpdateAllowedIpRequest,
    UserListItem,
    UserOut,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])
bearer_scheme = HTTPBearer(auto_error=False)


def get_client_ip(request: Request) -> str | None:
    return request.client.host if request.client is not None else None


def _ip_not_allowed() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail={"code": "ip_not_allowed", "message": "IP no autorizada"},
    )


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    unauthorized = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No autenticado")
    if credentials is None:
        raise unauthorized
    try:
        payload = decode_access_token(credentials.credentials)
    except jwt.InvalidTokenError:
        raise unauthorized
    try:
        user_id = int(payload["sub"])
    except (KeyError, ValueError):
        raise unauthorized
    user = await db.get(User, user_id)
    if user is None or not user.is_active:
        raise unauthorized
    if not user.is_admin and user.allowed_ip is not None and user.allowed_ip != get_client_ip(request):
        raise _ip_not_allowed()
    return user


async def require_active_user(current_user: User = Depends(get_current_user)) -> User:
    if current_user.must_change_password:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "password_change_required", "message": "Debes cambiar tu contraseña"},
        )
    return current_user


async def require_admin(current_user: User = Depends(require_active_user)) -> User:
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "admin_required", "message": "Requiere permisos de administrador"},
        )
    return current_user


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    client_ip = get_client_ip(request)
    user = await db.scalar(select(User).where(User.email == payload.email.lower()))
    if user is None or not user.is_active or not verify_password(payload.password, user.password_hash):
        await registrar_evento(
            db,
            user_id=user.id if user is not None else None,
            user_email=payload.email,
            action="auth.login_failed",
            ip_address=client_ip,
        )
        await db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenciales inválidas")
    if not user.is_admin:
        if user.allowed_ip is None:
            user.allowed_ip = client_ip
        elif user.allowed_ip != client_ip:
            await registrar_evento(
                db,
                user_id=user.id,
                user_email=user.email,
                action="auth.login_blocked_ip",
                ip_address=client_ip,
                details={"ip_esperada": user.allowed_ip},
            )
            await db.commit()
            raise _ip_not_allowed()
    await registrar_evento(
        db, user_id=user.id, user_email=user.email, action="auth.login_success", ip_address=client_ip
    )
    token = create_access_token(user_id=user.id, email=user.email)
    await db.commit()
    return TokenResponse(access_token=token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    await registrar_evento(
        db,
        user_id=current_user.id,
        user_email=current_user.email,
        action="auth.logout",
        ip_address=get_client_ip(request),
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me", response_model=UserOut)
async def me(current_user: User = Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(current_user)


@router.patch("/me/password", response_model=UserOut)
async def change_own_password(
    payload: ChangeOwnPasswordRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> UserOut:
    if not verify_password(payload.current_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Contraseña actual incorrecta"
        )
    if verify_password(payload.new_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La nueva contraseña debe ser diferente a la actual",
        )
    current_user.password_hash = hash_password(payload.new_password)
    current_user.must_change_password = False
    await registrar_evento(
        db,
        user_id=current_user.id,
        user_email=current_user.email,
        action="auth.change_own_password",
        ip_address=get_client_ip(request),
    )
    await db.commit()
    await db.refresh(current_user)
    return UserOut.model_validate(current_user)


@router.get("/users", response_model=list[UserListItem])
async def list_users(
    db: AsyncSession = Depends(get_db), _admin: User = Depends(require_admin)
) -> list[UserListItem]:
    result = await db.scalars(select(User).order_by(User.id))
    return [UserListItem.model_validate(u) for u in result.all()]


@router.post("/users", response_model=UserListItem, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: CreateUserRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> UserListItem:
    existing = await db.scalar(select(User).where(User.email == payload.email.lower()))
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ya existe un usuario con ese email",
        )
    user = User(
        email=payload.email.lower(),
        password_hash=hash_password(payload.password),
        full_name=payload.full_name,
        is_admin=payload.is_admin,
        must_change_password=True,
    )
    db.add(user)
    await db.flush()
    await registrar_evento(
        db,
        user_id=admin.id,
        user_email=admin.email,
        action="usuarios.create_user",
        ip_address=get_client_ip(request),
        details={
            "usuario_creado_id": user.id,
            "usuario_creado_email": user.email,
            "es_admin": user.is_admin,
        },
    )
    await db.commit()
    await db.refresh(user)
    return UserListItem.model_validate(user)


@router.patch("/users/{user_id}/allowed-ip", response_model=UserListItem)
async def update_allowed_ip(
    user_id: int,
    payload: UpdateAllowedIpRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> UserListItem:
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado")
    ip_anterior = user.allowed_ip
    user.allowed_ip = payload.allowed_ip
    await registrar_evento(
        db,
        user_id=admin.id,
        user_email=admin.email,
        action="usuarios.update_allowed_ip",
        ip_address=get_client_ip(request),
        details={
            "usuario_objetivo_id": user.id,
            "ip_anterior": ip_anterior,
            "ip_nueva": payload.allowed_ip,
        },
    )
    await db.commit()
    await db.refresh(user)
    return UserListItem.model_validate(user)


@router.patch("/users/{user_id}/password", response_model=UserListItem)
async def reset_password(
    user_id: int,
    payload: ResetPasswordRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> UserListItem:
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado")
    user.password_hash = hash_password(payload.new_password)
    user.must_change_password = True
    await registrar_evento(
        db,
        user_id=admin.id,
        user_email=admin.email,
        action="usuarios.reset_password",
        ip_address=get_client_ip(request),
        details={"usuario_objetivo_id": user.id},
    )
    await db.commit()
    await db.refresh(user)
    return UserListItem.model_validate(user)
