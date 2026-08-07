import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { AdministracionUsuariosComponent } from './administracion-usuarios.component';
import { AuthService } from '../../core/auth.service';

describe('AdministracionUsuariosComponent', () => {
  let fixture: ComponentFixture<AdministracionUsuariosComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdministracionUsuariosComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { logout: vi.fn(), loadCurrentUser: vi.fn().mockReturnValue(of(null)) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdministracionUsuariosComponent);
    fixture.detectChanges();
  });

  it('renders the page title', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Administración de Usuarios');
  });

  it('renders the placeholder users table', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Ana Silva Pérez');
    expect(text).toContain('ana.silva@icmloja.gob.ec');
  });
});
