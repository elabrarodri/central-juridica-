import fs from 'fs/promises';
import path from 'path';
import { chromium } from 'playwright';

const LOGIN_URL = 'https://app.faz.adv.br/#/login';
const PUBLICACOES_URL = 'https://app.faz.adv.br/#/publicacoes/nao-lidas';
const OUTPUT_PATH = 'data/publicacoes.json';
const DEBUG_DIR = 'tmp-debug';

const EMAIL = process.env.FAZ_EMAIL;
const SENHA = process.env.FAZ_SENHA;

if (!EMAIL || !SENHA) {
  console.error('Defina FAZ_EMAIL e FAZ_SENHA nas variáveis de ambiente.');
  process.exit(1);
}

async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function saveDebug(page, reason) {
  await fs.mkdir(DEBUG_DIR, { recursive: true });
  await page.screenshot({ path: `${DEBUG_DIR}/erro.png`, fullPage: true }).catch(() => {});
  const html = await page.content().catch(() => '<html><body>Sem conteúdo</body></html>');
  await fs.writeFile(`${DEBUG_DIR}/erro.html`, html, 'utf8').catch(() => {});
  await fs.writeFile(`${DEBUG_DIR}/motivo.txt`, `${reason}\n`, 'utf8').catch(() => {});
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });

    const emailField = page.locator('input[type="email"], input[name*="mail" i], input[placeholder*="mail" i], input[type="text"]').first();
    const senhaField = page.locator('input[type="password"], input[name*="senha" i], input[placeholder*="senha" i]').first();

    await emailField.waitFor({ timeout: 30000 });
    await senhaField.waitFor({ timeout: 30000 });

    await emailField.fill(EMAIL);
    await senhaField.fill(SENHA);

    const btnEntrar = page.getByRole('button', { name: /entrar|acessar|login/i }).first();
    if (await btnEntrar.isVisible().catch(() => false)) {
      await btnEntrar.click();
    } else {
      await page.keyboard.press('Enter');
    }

    await page.waitForTimeout(5000);
    await page.goto(PUBLICACOES_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForTimeout(5000);

    const rows = page.locator('mat-card, .mat-card, tr, tbody tr, li, .card, .list-group-item');
    const count = await rows.count();

    const publicacoes = [];
    const vistos = new Set();

    for (let i = 0; i < count; i += 1) {
      const conteudo = (await rows.nth(i).innerText().catch(() => '')).trim();
      if (conteudo.length < 30) continue;

      const assinatura = conteudo.replace(/\s+/g, ' ').slice(0, 280);
      if (vistos.has(assinatura)) continue;
      vistos.add(assinatura);

      const dataMatch = conteudo.match(/\b\d{2}\/\d{2}\/\d{4}\b/);

      publicacoes.push({
        id: `${Date.now()}-${i}`,
        data: dataMatch ? dataMatch[0] : '',
        conteudoCompleto: conteudo,
      });
    }

    if (publicacoes.length === 0) {
      throw new Error('Nenhuma publicação encontrada. Verifique seletores/login.');
    }

    const payload = {
      origem: PUBLICACOES_URL,
      atualizadoEm: new Date().toISOString(),
      total: publicacoes.length,
      publicacoes,
    };

    await ensureDir(OUTPUT_PATH);
    await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    console.log(`Arquivo atualizado: ${OUTPUT_PATH} (${publicacoes.length} publicações)`);
  } catch (err) {
    await saveDebug(page, String(err));
    throw err;
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error('Falha na sincronização:', err);
  process.exit(1);
});
