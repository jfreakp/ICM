import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { AdministracionUsuariosComponent } from './administracion-usuarios.component';
import { AuthService } from '../../core/auth.service';
import { UsersService } from '../../core/users.service';
import { UserListItem } from '../../core/models/user-list-item.model';

describe('AdministracionUsuariosComponent', () => {
  let fixture: ComponentFixture<AdministracionUsuariosComponent>;
  let usersService: { listUsers: ReturnType<typeof vi.fn>; updateAllowedIp: ReturnType<typeof vi.fn> };

  const usuarios: UserListItem[] = [
    { id: 1, email: 'ana.silva@icmloja.gob.ec', full_name: 'Ana Silva Pérez', is_admin: true, is_active: true, allowed_ip: '10.0.0.5' },
    { id: 2, email: 'c.mendoza@icmloja.gob.ec', full_name: 'Carlos Mendoza', is_admin: false, is_active: true, allowed_ip: null },
  ];

  beforeEach(async () => {
    usersService = {
      listUsers: vi.fn().mockReturnValue(of(usuarios)),
      updateAllowedIp: vi.fn().mockReturnValue(of({ ...usuarios[0], allowed_ip: null })),
    };

    await TestBed.configureTestingModule({
      imports: [AdministracionUsuariosComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { logout: vi.fn(), loadCurrentUser: vi.fn().mockReturnValue(of(null)) } },
        { provide: UsersService, useValue: usersService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdministracionUsuariosComponent);
    fixture.detectChanges();
  });

  it('renders the page title', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Administración de Usuarios');
  });

  it('renders users fetched from UsersService', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Ana Silva Pérez');
    expect(text).toContain('c.mendoza@icmloja.gob.ec');
    expect(text).toContain('10.0.0.5');
  });

  it('calls updateAllowedIp with null when resetting a user IP', () => {
    fixture.componentInstance.resetAllowedIp(usuarios[0]);
    expect(usersService.updateAllowedIp).toHaveBeenCalledWith(1, null);
  });
});
