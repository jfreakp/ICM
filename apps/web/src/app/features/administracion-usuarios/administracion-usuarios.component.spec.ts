import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject } from 'rxjs';
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

  describe('async rendering under zoneless change detection', () => {
    // Regression test for a live bug: the component used to assign the HTTP
    // response directly to a plain `usuarios` field inside a manual
    // `.subscribe(...)` callback. Under this app's zoneless change
    // detection, that assignment never notifies Angular's change detection
    // scheduler, so the real HTTP response arrived (confirmed via
    // ng.getComponent devtools) but the table never re-rendered - it stayed
    // stuck at "Mostrando 0 de 0 usuarios" forever, even after user
    // interaction elsewhere on the page.
    //
    // A synchronous `of(...)` response (used by the other tests above) masks
    // this bug: it emits during ngOnInit, and because usuarios$ is backed by
    // a BehaviorSubject, the AsyncPipe replays that value the moment it
    // subscribes during the very same initial `fixture.detectChanges()`
    // call - so the table renders correctly on the first render regardless
    // of whether the fix is in place.
    //
    // To catch the real bug, the HTTP response must arrive strictly *after*
    // the first render, and the DOM update must happen through Angular's own
    // automatic (zoneless) scheduling - i.e. via `fixture.whenStable()`, not
    // a second manual `fixture.detectChanges()` call, since a manual call
    // forces a synchronous re-check regardless of whether anything actually
    // notified the change detection scheduler.
    it('renders the table once the deferred user list response arrives', async () => {
      const usuarios$ = new Subject<UserListItem[]>();
      usersService.listUsers.mockReturnValue(usuarios$);

      const localFixture = TestBed.createComponent(AdministracionUsuariosComponent);
      localFixture.detectChanges();

      // Before the observable emits, no rows should be rendered.
      const rowsBefore = (localFixture.nativeElement as HTMLElement).querySelectorAll('tbody tr');
      expect(rowsBefore.length).toBe(0);
      expect((localFixture.nativeElement as HTMLElement).textContent ?? '').toContain('Mostrando 0 de 0 usuarios');

      // The HTTP response arrives asynchronously, well after the first render.
      usuarios$.next(usuarios);

      // No manual detectChanges() here - only Angular's own zoneless
      // scheduler (triggered by AsyncPipe's markForCheck()) should be
      // responsible for updating the DOM.
      await localFixture.whenStable();

      const rowsAfter = (localFixture.nativeElement as HTMLElement).querySelectorAll('tbody tr');
      expect(rowsAfter.length).toBe(2);
      const text = (localFixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('Ana Silva Pérez');
      expect(text).toContain('Carlos Mendoza');
      expect(text).toContain('Mostrando 2 de 2 usuarios');
    });
  });

  describe('error feedback', () => {
    // Same async-timing rigor as the c4b6a2c fix: the error must arrive
    // strictly after the first render, and the DOM update must happen
    // through Angular's own zoneless scheduling (fixture.whenStable()),
    // not a manual detectChanges() call - otherwise the test would pass
    // even if the error state were wired through a plain field write.
    it('shows an error message when listUsers fails', async () => {
      const usuarios$ = new Subject<UserListItem[]>();
      usersService.listUsers.mockReturnValue(usuarios$);

      const localFixture = TestBed.createComponent(AdministracionUsuariosComponent);
      localFixture.detectChanges();

      expect((localFixture.nativeElement as HTMLElement).textContent ?? '').not.toContain(
        'No tienes permisos para ver esta página.'
      );

      usuarios$.error(new Error('403 Forbidden'));

      await localFixture.whenStable();

      const text = (localFixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('No tienes permisos para ver esta página.');
    });

    it('shows an error message when updateAllowedIp fails', async () => {
      const updateResult$ = new Subject<UserListItem>();
      usersService.updateAllowedIp.mockReturnValue(updateResult$);

      fixture.componentInstance.resetAllowedIp(usuarios[0]);
      fixture.detectChanges();

      expect((fixture.nativeElement as HTMLElement).textContent ?? '').not.toContain(
        'No se pudo actualizar la IP. Intenta de nuevo.'
      );

      updateResult$.error(new Error('403 Forbidden'));

      await fixture.whenStable();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('No se pudo actualizar la IP. Intenta de nuevo.');
    });
  });
});
