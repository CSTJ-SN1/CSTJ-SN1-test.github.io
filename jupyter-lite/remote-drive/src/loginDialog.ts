/**
 * Fenêtre de connexion en DOM simple : elle s'affiche avant que JupyterLab
 * ait démarré (le drive doit être authentifié pour que l'application se
 * charge), donc sans les widgets ni le thème de JupyterLab.
 */

export interface ILoginDialogOptions {
  /**
   * Message affiché au-dessus du formulaire (ex. session expirée).
   */
  message?: string;

  /**
   * Nom d'utilisateur pré-rempli.
   */
  username?: string;

  /**
   * Empêche de changer de nom d'utilisateur (reconnexion après expiration).
   */
  lockUsername?: boolean;

  /**
   * Appelé par le lien « Changer d'utilisateur » quand le nom est verrouillé.
   */
  onSwitchUser?: () => void;

  /**
   * Tente la connexion ; une exception affiche son message dans la fenêtre.
   */
  submit: (username: string, password: string, remember: boolean) => Promise<void>;
}

const STYLE_ID = 'cstj-remote-drive-login-style';

const STYLE = `
.cstj-login-overlay {
  position: fixed;
  inset: 0;
  z-index: 100000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgb(0 0 0 / 55%);
  font-family: var(--jp-ui-font-family, system-ui, -apple-system, 'Segoe UI', sans-serif);
}
.cstj-login-card {
  box-sizing: border-box;
  width: 100%;
  max-width: 400px;
  max-height: 100%;
  overflow: auto;
  padding: 24px;
  border-radius: 8px;
  background: var(--jp-layout-color1, #fff);
  color: var(--jp-ui-font-color1, #1f2328);
  box-shadow: 0 10px 30px rgb(0 0 0 / 30%);
  font-size: 14px;
  line-height: 1.45;
}
.cstj-login-card h2 {
  margin: 0 0 4px;
  font-size: 20px;
}
.cstj-login-card .cstj-login-subtitle {
  margin: 0 0 16px;
  color: var(--jp-ui-font-color2, #59636e);
}
.cstj-login-card .cstj-login-message {
  margin: 0 0 16px;
  padding: 8px 12px;
  border-radius: 4px;
  background: var(--jp-warn-color3, #fff4d6);
  color: var(--jp-ui-font-color1, #1f2328);
}
.cstj-login-card label.cstj-login-field {
  display: block;
  margin-bottom: 12px;
  font-weight: 600;
}
.cstj-login-card input[type='text'],
.cstj-login-card input[type='password'] {
  box-sizing: border-box;
  display: block;
  width: 100%;
  margin-top: 4px;
  padding: 8px;
  border: 1px solid var(--jp-border-color1, #8c959f);
  border-radius: 4px;
  background: var(--jp-input-background, #fff);
  color: inherit;
  font: inherit;
  font-weight: 400;
}
.cstj-login-card input[readonly] {
  background: var(--jp-layout-color2, #eef1f4);
}
.cstj-login-card .cstj-login-remember {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  margin: 4px 0 8px;
}
.cstj-login-card .cstj-login-important {
  margin: 0 0 16px;
  padding: 8px 12px;
  border-left: 4px solid var(--jp-error-color1, #cf222e);
  background: var(--jp-error-color3, #ffebe9);
  color: var(--jp-ui-font-color1, #1f2328);
  font-size: 13px;
}
.cstj-login-card .cstj-login-error {
  min-height: 1.45em;
  margin: 0 0 12px;
  color: var(--jp-error-color1, #cf222e);
}
.cstj-login-card button {
  font: inherit;
  cursor: pointer;
}
.cstj-login-card .cstj-login-submit {
  width: 100%;
  padding: 10px;
  border: 0;
  border-radius: 4px;
  background: var(--jp-brand-color1, #0969da);
  color: #fff;
  font-weight: 600;
}
.cstj-login-card .cstj-login-submit:disabled {
  opacity: 0.6;
  cursor: progress;
}
.cstj-login-card .cstj-login-switch {
  display: block;
  margin: -4px 0 12px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--jp-content-link-color, #0969da);
  text-decoration: underline;
  font-size: 13px;
}
`;

/**
 * Affiche la fenêtre de connexion jusqu'à ce que `submit` réussisse.
 */
export function showLoginDialog(options: ILoginDialogOptions): Promise<void> {
  ensureStyle();

  return new Promise(resolve => {
    const overlay = element('div', 'cstj-login-overlay');
    const card = element('form', 'cstj-login-card') as HTMLFormElement;
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'cstj-login-title');
    card.noValidate = true;

    const title = element('h2');
    title.id = 'cstj-login-title';
    title.textContent = 'Connexion';
    const subtitle = element('p', 'cstj-login-subtitle');
    subtitle.textContent = 'Vos fichiers sont enregistrés en ligne et vous suivent sur tous les ordinateurs.';
    card.append(title, subtitle);

    if (options.message) {
      const message = element('p', 'cstj-login-message');
      message.setAttribute('role', 'status');
      message.textContent = options.message;
      card.append(message);
    }

    const username = input('text', 'username');
    username.value = options.username ?? '';
    username.readOnly = !!options.lockUsername;
    card.append(field("Nom d'utilisateur", username));

    if (options.lockUsername && options.onSwitchUser) {
      const switchUser = element('button', 'cstj-login-switch') as HTMLButtonElement;
      switchUser.type = 'button';
      switchUser.textContent = "Ce n'est pas vous ? Changer d'utilisateur";
      switchUser.addEventListener('click', () => {
        const ok = window.confirm(
          "Changer d'utilisateur recharge la page : les modifications non enregistrées seront perdues. Continuer ?"
        );
        if (ok) {
          options.onSwitchUser!();
        }
      });
      card.append(switchUser);
    }

    const password = input('password', 'current-password');
    card.append(field('Mot de passe', password));

    const rememberLabel = element('label', 'cstj-login-remember');
    const remember = input('checkbox');
    remember.setAttribute('aria-describedby', 'cstj-login-important');
    rememberLabel.append(remember, document.createTextNode('Rester connecté sur cet ordinateur (30 jours)'));

    const important = element('p', 'cstj-login-important');
    important.id = 'cstj-login-important';
    const strong = element('strong');
    strong.textContent = 'IMPORTANT!';
    important.append(
      strong,
      document.createTextNode(
        ' Ne cochez pas cette case sur un ordinateur du collège ou tout autre ' +
          'ordinateur partagé : la personne suivante aurait accès à vos fichiers. ' +
          'Sans la case, vous êtes déconnecté à la fermeture du navigateur.'
      )
    );

    const error = element('p', 'cstj-login-error');
    error.setAttribute('role', 'alert');

    const submit = element('button', 'cstj-login-submit') as HTMLButtonElement;
    submit.type = 'submit';
    submit.textContent = 'Se connecter';

    card.append(rememberLabel, important, error, submit);
    overlay.append(card);
    document.body.append(overlay);

    (options.lockUsername || username.value ? password : username).focus();

    card.addEventListener('submit', event => {
      event.preventDefault();

      if (!username.value.trim() || !password.value) {
        error.textContent = "Entrez votre nom d'utilisateur et votre mot de passe.";
        return;
      }

      submit.disabled = true;
      submit.textContent = 'Connexion…';
      error.textContent = '';

      options
        .submit(username.value.trim(), password.value, remember.checked)
        .then(() => {
          overlay.remove();
          resolve();
        })
        .catch((reason: unknown) => {
          error.textContent =
            reason instanceof Error ? reason.message : 'La connexion a échoué.';
          password.value = '';
          password.focus();
          submit.disabled = false;
          submit.textContent = 'Se connecter';
        });
    });
  });
}

/**
 * Fenêtre bloquante pour une erreur de configuration (l'application ne peut
 * pas démarrer).
 */
export function showFatalError(message: string): Promise<void> {
  ensureStyle();

  const overlay = element('div', 'cstj-login-overlay');
  const card = element('div', 'cstj-login-card');
  card.setAttribute('role', 'alertdialog');
  const title = element('h2');
  title.textContent = "L'éditeur ne peut pas démarrer";
  const text = element('p', 'cstj-login-error');
  text.textContent = message;
  card.append(title, text);
  overlay.append(card);
  document.body.append(overlay);

  return Promise.resolve();
}

function ensureStyle(): void {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLE;
    document.head.append(style);
  }
}

function element(tag: string, className?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  return node;
}

function input(type: string, autocomplete?: string): HTMLInputElement {
  const node = document.createElement('input');
  node.type = type;
  if (autocomplete) {
    node.autocomplete = autocomplete as AutoFill;
    node.name = autocomplete;
  }
  if (type !== 'checkbox') {
    node.required = true;
    node.spellcheck = false;
    node.setAttribute('autocapitalize', 'off');
  }
  return node;
}

function field(label: string, control: HTMLInputElement): HTMLElement {
  const wrapper = element('label', 'cstj-login-field');
  wrapper.append(document.createTextNode(label), control);
  return wrapper;
}
