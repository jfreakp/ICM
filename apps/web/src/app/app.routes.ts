import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';
import { LoginComponent } from './features/login/login.component';
import { HomeComponent } from './features/home/home.component';
import { CambiarContrasenaComponent } from './features/cambiar-contrasena/cambiar-contrasena.component';
import { ImpugnacionesComponent } from './features/reportes/impugnaciones/impugnaciones.component';
import { InfraccionesComponent } from './features/reportes/infracciones/infracciones.component';
import { JuiciosComponent } from './features/reportes/juicios/juicios.component';
import { PagosComponent } from './features/reportes/pagos/pagos.component';
import { TitulosComponent } from './features/reportes/titulos/titulos.component';
import { ModificacionInfraccionesComponent } from './features/reportes/modificacion-infracciones/modificacion-infracciones.component';
import { CrvComponent } from './features/reportes/crv/crv.component';
import { LibretinesComponent } from './features/reportes/libretines/libretines.component';
import { AdministracionUsuariosComponent } from './features/administracion-usuarios/administracion-usuarios.component';
import { AuditoriaComponent } from './features/auditoria/auditoria.component';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: 'home', component: HomeComponent, canActivate: [authGuard] },
  { path: 'cambiar-contrasena', component: CambiarContrasenaComponent, canActivate: [authGuard] },
  { path: 'reportes/impugnaciones', component: ImpugnacionesComponent, canActivate: [authGuard] },
  { path: 'reportes/infracciones', component: InfraccionesComponent, canActivate: [authGuard] },
  { path: 'reportes/juicios', component: JuiciosComponent, canActivate: [authGuard] },
  { path: 'reportes/pagos', component: PagosComponent, canActivate: [authGuard] },
  { path: 'reportes/titulos', component: TitulosComponent, canActivate: [authGuard] },
  { path: 'reportes/modificacion-infracciones', component: ModificacionInfraccionesComponent, canActivate: [authGuard] },
  { path: 'reportes/crv', component: CrvComponent, canActivate: [authGuard] },
  { path: 'reportes/libretines', component: LibretinesComponent, canActivate: [authGuard] },
  { path: 'usuarios', component: AdministracionUsuariosComponent, canActivate: [authGuard] },
  { path: 'auditoria', component: AuditoriaComponent, canActivate: [authGuard] },
  { path: '', redirectTo: 'home', pathMatch: 'full' },
  { path: '**', redirectTo: 'home' },
];
