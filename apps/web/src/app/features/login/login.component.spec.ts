import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { of, throwError, Subject } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { Mock, vi } from 'vitest';
import { LoginComponent } from './login.component';
import { AuthService } from '../../core/auth.service';

describe('LoginComponent', () => {
  let fixture: ComponentFixture<LoginComponent>;
  let component: LoginComponent;
  let authService: { login: Mock };
  let router: { navigate: Mock };

  beforeEach(async () => {
    authService = { login: vi.fn() };
    router = { navigate: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [LoginComponent, ReactiveFormsModule],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: Router, useValue: router },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null } } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
  });

  it('navigates to /home on successful login', () => {
    authService.login.mockReturnValue(of({ id: 1, email: 'a@b.com', full_name: 'A' }));
    component.form.setValue({ email: 'a@b.com', password: 'secret' });

    component.onSubmit();

    expect(authService.login).toHaveBeenCalledWith('a@b.com', 'secret');
    expect(router.navigate).toHaveBeenCalledWith(['/home']);
  });

  it('shows an error message on failed login', () => {
    authService.login.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 401, error: { detail: 'Credenciales inválidas' } }))
    );
    component.form.setValue({ email: 'a@b.com', password: 'wrong' });

    component.onSubmit();

    let latest: string | null = null;
    component.errorMessage$.subscribe((value) => (latest = value));
    expect(latest).toBe('Credenciales inválidas');
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('does not call login when the form is invalid', () => {
    component.form.setValue({ email: '', password: '' });

    component.onSubmit();

    expect(authService.login).not.toHaveBeenCalled();
  });

  describe('async rendering under zoneless change detection', () => {
    // Regression test for a live bug: the component used to assign the
    // failed-login message directly to a plain `errorMessage` field inside
    // a manual `.subscribe({ error: ... })` callback. Under this app's
    // zoneless change detection, that assignment never notifies Angular's
    // change detection scheduler, so the component's field was genuinely
    // set (confirmed via ng.getComponent devtools) but the DOM's
    // `@if (errorMessage) { ... }` block never re-rendered - the user saw
    // nothing happen when their login was rejected (bad credentials or an
    // IP-lock 403).
    //
    // A synchronous `throwError(...)` response (used by the test above)
    // masks this bug when paired with a manual `fixture.detectChanges()`
    // call after `onSubmit()`, because a manual call forces a synchronous
    // re-check regardless of whether anything notified the change
    // detection scheduler. To catch the real bug, the HTTP error must
    // arrive strictly *after* the first render, and the DOM update must
    // happen through Angular's own automatic (zoneless) scheduling - i.e.
    // via `fixture.whenStable()`, not a second manual `detectChanges()`.
    //
    // Note: `form.setValue(...)` is called *before* the first
    // `detectChanges()`, not after. Writing reactive-form values into
    // already-rendered `<input>` elements goes through each control's
    // ControlValueAccessor, which performs its own Renderer2 DOM write -
    // and that write itself is enough to trigger an incidental zoneless CD
    // tick independent of any `markForCheck()` call. That tick would then
    // pick up the later plain-field mutation too and falsely mask the bug.
    // Verified empirically: setting the form *after* the first render made
    // this test pass even against the pre-fix `errorMessage` plain-field
    // implementation.
    it('renders the error message in the DOM once the deferred login error arrives', async () => {
      const login$ = new Subject<{ id: number; email: string; full_name: string }>();
      authService.login.mockReturnValue(login$);

      const localFixture = TestBed.createComponent(LoginComponent);
      const localComponent = localFixture.componentInstance;
      localComponent.form.setValue({ email: 'a@b.com', password: 'wrong' });
      localFixture.detectChanges();

      localComponent.onSubmit();

      // Before the observable errors, no message should be rendered.
      const textBefore = (localFixture.nativeElement as HTMLElement).textContent ?? '';
      expect(textBefore).not.toContain('Credenciales inválidas');

      // The HTTP error arrives asynchronously, well after the first render.
      login$.error(new HttpErrorResponse({ status: 401, error: { detail: 'Credenciales inválidas' } }));

      // No manual detectChanges() here - only Angular's own zoneless
      // scheduler (triggered by AsyncPipe's markForCheck()) should be
      // responsible for updating the DOM.
      await localFixture.whenStable();

      const textAfter = (localFixture.nativeElement as HTMLElement).textContent ?? '';
      expect(textAfter).toContain('Credenciales inválidas');
      expect(router.navigate).not.toHaveBeenCalled();
    });
  });
});
