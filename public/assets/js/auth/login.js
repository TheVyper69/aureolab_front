import { authService } from '../services/authService.js';
import { required, isEmail } from '../utils/validators.js';

export function renderLogin(root){
  root.innerHTML = `
  <div class="auth-wrap">
    <div class="card auth-card">
      <div class="card-body p-4">
        <div class="text-center mb-3">
          <div class="text-center mb-3">
            <img src="./assets/images/logo.png" alt="Logo" style="max-width: 180px; height: auto;">
          </div>
         
        </div>

        <form id="loginForm" novalidate>
          <div class="mb-3">
            <label class="form-label">Correo</label>
            <input type="email" class="form-control" id="email" placeholder="correo@dominio.com" required>
            <div class="invalid-feedback">Ingresa un correo válido.</div>
          </div>

          <div class="mb-3">
            <label class="form-label">Contraseña</label>
            <input type="password" class="form-control" id="password" placeholder="••••••••" required>
            <div class="invalid-feedback">La contraseña es obligatoria.</div>
          </div>

          <button class="btn btn-brand w-100" type="submit" id="btnLogin">
            Entrar
          </button>
        </form>
      </div>
    </div>
  </div>
  `;

  const form = document.getElementById('loginForm');
  const btn = document.getElementById('btnLogin');

  form.addEventListener('submit', async (e)=>{
    e.preventDefault();

    const emailEl = document.getElementById('email');
    const passEl = document.getElementById('password');

    const email = emailEl.value.trim();
    const password = passEl.value;

    const emailOk = required(email) && isEmail(email);
    const passOk = required(password);

    emailEl.classList.toggle('is-invalid', !emailOk);
    passEl.classList.toggle('is-invalid', !passOk);
    if(!emailOk || !passOk) return;

    try{
      btn.disabled = true;
      btn.textContent = 'Entrando...';

      await authService.login({ email, password });

      // ✅ Redirección por rol
      const role = authService.getRole();
      if(role === 'optica') location.hash = '#/orders';     // o '#/pos' si quieres que entren al POS directo
      else if(role === 'employee') location.hash = '#/pos';
      else location.hash = '#/sales'; // admin
    }catch(err){
      const msg =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        err?.message ||
        'No se pudo iniciar sesión.';
      Swal.fire('Error', msg, 'error');
    }finally{
      btn.disabled = false;
      btn.textContent = 'Entrar';
    }
  });
}