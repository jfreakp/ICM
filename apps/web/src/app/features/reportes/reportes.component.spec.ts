import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { ReportesComponent } from './reportes.component';
import { AuthService } from '../../core/auth.service';

describe('ReportesComponent', () => {
  let fixture: ComponentFixture<ReportesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReportesComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { logout: vi.fn(), loadCurrentUser: vi.fn().mockReturnValue(of(null)) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ReportesComponent);
    fixture.detectChanges();
  });

  it('renders the page title', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Generación de Reportes de Multas');
  });

  it('renders the placeholder multas table', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('#MLT-2023-0891');
    expect(text).toContain('Juan Pérez Gómez');
  });
});
