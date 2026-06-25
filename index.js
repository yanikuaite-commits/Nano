const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = require('@whiskeysockets/baileys');
const Groq = require('groq-sdk');
const readline = require('readline');
const fs = require('fs');
const http = require('http');
const axios = require('axios');
const googleTTS = require('google-tts-api');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

const CONFIG = {
    MAX_RECONEXOES: 1000,
    TEMPO_RECONEXAO: 5000,
    KEEP_ALIVE: 30000,
    BOT_NAME: "Nano bot 🤖",
    CRIADOR: "made by Yanik Eusébio Uaite"
};

const groq = new Groq({
    apiKey: "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"
});

let tentativasReconexao = 0;
let motivoAusencia = null;
let numeroDono = null;
const historicoChats = {};
const bancoVIP = new Map();

const NIVEIS_VIP = {
    bronze: { nome: 'Bronze 🥉', comandosPorDia: 20, podeGerenciarGrupo: false, podeBanir: false, podeMutar: false, duracaoPadrao: 7 },
    prata: { nome: 'Prata 🥈', comandosPorDia: 50, podeGerenciarGrupo: false, podeBanir: false, podeMutar: true, duracaoPadrao: 15 },
    ouro: { nome: 'Ouro 🥇', comandosPorDia: 100, podeGerenciarGrupo: true, podeBanir: true, podeMutar: true, duracaoPadrao: 30 },
    diamante: { nome: 'Diamante 💎', comandosPorDia: 200, podeGerenciarGrupo: true, podeBanir: true, podeMutar: true, duracaoPadrao: 60 },
    lenda: { nome: 'Lenda 👑', comandosPorDia: 999, podeGerenciarGrupo: true, podeBanir: true, podeMutar: true, duracaoPadrao: 365 }
};

const gruposConfig = new Map();
const usuariosBanidos = new Map();
const usuariosMutados = new Map();

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!DOCTYPE html><html><head><title>${CONFIG.BOT_NAME}</title><style>body{background:#1a1a2e;color:#e94560;text-align:center;padding:50px;font-family:Arial}h1{font-size:2.5em}.pulse{animation:pulse 2s infinite}@keyframes pulse{0%{opacity:1}50%{opacity:.5}100%{opacity:1}}</style></head><body><h1>💜 ${CONFIG.BOT_NAME}</h1><p>${CONFIG.CRIADOR}</p><div class="pulse">🟢 Online 24/7</div></body></html>`);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`🌐 Porta: ${PORT}`));

function adicionarAoHistorico(chatId, role, content) {
    if (!historicoChats[chatId]) historicoChats[chatId] = [];
    historicoChats[chatId].push({ role, content });
    if (historicoChats[chatId].length > 20) historicoChats[chatId].shift();
}

function formatarMenu(titulo, comandos) {
    let menu = `╭┈⊰ 💜 『 *${CONFIG.BOT_NAME}* 』\n┊Olá, seja bem-vindo(a)!\n╰─┈┈┈┈┈◜❁◞┈┈┈┈┈─╯\n\n╭┈❁ *${titulo}*\n┊\n`;
    comandos.forEach(cmd => { menu += `┊💜 ${cmd}\n`; });
    menu += `╰─┈┈┈┈┈◜❁◞┈┈┈┈┈─╯\n\n✨ *${CONFIG.CRIADOR}* ✨`;
    return menu;
}function adicionarVIP(numero, nivel = 'bronze', dias = null) {
    const configNivel = NIVEIS_VIP[nivel];
    const diasVIP = dias || configNivel.duracaoPadrao;
    const expiraEm = Date.now() + (diasVIP * 24 * 60 * 60 * 1000);
    bancoVIP.set(numero, { numero, nivel, adicionadoEm: Date.now(), expiraEm, diasTotal: diasVIP, comandosHoje: 0, ultimoReset: Date.now() });
    return { nivel: configNivel.nome, dias: diasVIP, expira: new Date(expiraEm).toLocaleDateString('pt-BR') };
}

function isVIP(numero) {
    const vip = bancoVIP.get(numero);
    if (!vip) return false;
    if (Date.now() > vip.expiraEm) { bancoVIP.delete(numero); return false; }
    if (Date.now() - vip.ultimoReset > 24 * 60 * 60 * 1000) { vip.comandosHoje = 0; vip.ultimoReset = Date.now(); }
    return true;
}

function podeGerenciarGrupo(numero) {
    if (numero === numeroDono) return true;
    const vip = bancoVIP.get(numero);
    return vip ? NIVEIS_VIP[vip.nivel].podeGerenciarGrupo : false;
}

function podeBanir(numero) {
    if (numero === numeroDono) return true;
    const vip = bancoVIP.get(numero);
    return vip ? NIVEIS_VIP[vip.nivel].podeBanir : false;
}

function podeMutar(numero) {
    if (numero === numeroDono) return true;
    const vip = bancoVIP.get(numero);
    return vip ? NIVEIS_VIP[vip.nivel].podeMutar : false;
}

function tempoRestanteVIP(numero) {
    const vip = bancoVIP.get(numero);
    if (!vip) return null;
    const restante = vip.expiraEm - Date.now();
    if (restante <= 0) return 'Expirado';
    const dias = Math.floor(restante / (24 * 60 * 60 * 1000));
    const horas = Math.floor((restante % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    return `${dias}d ${horas}h`;
}async function criarSticker(sock, msg, remetente) {
    try {
        let buffer;
        if (msg.message.imageMessage) {
            buffer = await downloadMediaMessage(msg, 'buffer', {});
        } else if (msg.message.videoMessage) {
            if (msg.message.videoMessage.seconds > 10) {
                await sock.sendMessage(remetente, { text: "❌ Vídeo máximo 10 segundos!" });
                return;
            }
            buffer = await downloadMediaMessage(msg, 'buffer', {});
        } else {
            await sock.sendMessage(remetente, { text: "❌ Envia imagem/vídeo com o comando!" });
            return;
        }
        await sock.sendMessage(remetente, { sticker: buffer, stickerAuthor: CONFIG.BOT_NAME, stickerName: CONFIG.CRIADOR });
    } catch (erro) {
        await sock.sendMessage(remetente, { text: "❌ Erro ao criar sticker!" });
    }
}

async function baixarMusica(sock, remetente, query) {
    try {
        await sock.sendMessage(remetente, { text: "🎵 Buscando música..." });
        const response = await axios.get(`https://api.zenkey.ml/api/downloader/ytplay?query=${encodeURIComponent(query)}`);
        if (response.data?.url) {
            await sock.sendMessage(remetente, { audio: { url: response.data.url }, mimetype: 'audio/mpeg', fileName: `${query}.mp3` });
        } else {
            await sock.sendMessage(remetente, { text: "❌ Música não encontrada!" });
        }
    } catch (error) {
        await sock.sendMessage(remetente, { text: "❌ Erro ao baixar música!" });
    }
}

async function baixarTikTok(sock, remetente, url) {
    try {
        await sock.sendMessage(remetente, { text: "📱 Baixando TikTok..." });
        const response = await axios.get(`https://api.zenkey.ml/api/downloader/tiktok?url=${encodeURIComponent(url)}`);
        if (response.data?.video) {
            await sock.sendMessage(remetente, { video: { url: response.data.video }, caption: "✅ Aqui está! 💜" });
        } else {
            await sock.sendMessage(remetente, { text: "❌ Link inválido!" });
        }
    } catch (error) {
        await sock.sendMessage(remetente, { text: "❌ Erro!" });
    }
}async function criarLogo(sock, remetente, tipo, texto) {
    try {
        const tipos = { '3d': '3dlogo', 'neon': 'neonlogo', 'fogo': 'flamelogo', 'flame': 'flamelogo', 'game': 'gamelogo', 'metal': 'metallogo' };
        const endpoint = tipos[tipo] || '3dlogo';
        await sock.sendMessage(remetente, { text: `🎨 Criando logo ${tipo}...` });
        const url = `https://api.zenkey.ml/api/maker/${endpoint}?text=${encodeURIComponent(texto)}`;
        await sock.sendMessage(remetente, { image: { url }, caption: `✅ Logo ${tipo}: "${texto}"\n✨ ${CONFIG.CRIADOR}` });
    } catch (error) {
        await sock.sendMessage(remetente, { text: "❌ Erro!" });
    }
}

async function verClima(sock, remetente, cidade) {
    try {
        const response = await axios.get(`https://wttr.in/${encodeURIComponent(cidade)}?format=%C+%t+%h+%w&lang=pt`);
        await sock.sendMessage(remetente, { text: `🌤️ *Clima em ${cidade}*\n\n${response.data.trim()}\n\n✨ ${CONFIG.CRIADOR}` });
    } catch (error) {
        await sock.sendMessage(remetente, { text: "❌ Cidade não encontrada!" });
    }
}

async function traduzirTexto(sock, remetente, texto) {
    try {
        const response = await axios.get(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=pt&dt=t&q=${encodeURIComponent(texto)}`);
        await sock.sendMessage(remetente, { text: `📝 *Tradução:*\n\n${response.data[0][0][0]}\n\n✨ ${CONFIG.CRIADOR}` });
    } catch (error) {
        await sock.sendMessage(remetente, { text: "❌ Erro!" });
    }
}

async function cotacaoMoeda(sock, remetente, moeda) {
    try {
        const response = await axios.get('https://economia.awesomeapi.com.br/json/last/USD-BRL,USD-MZN,EUR-BRL');
        let texto = '';
        if (moeda === 'dolar') {
            const usd = response.data.USDBRL;
            texto = `💵 *Dólar*\n\n🇧🇷 R$ ${parseFloat(usd.bid).toFixed(2)}\n📈 Máx: R$ ${parseFloat(usd.high).toFixed(2)}\n📉 Mín: R$ ${parseFloat(usd.low).toFixed(2)}`;
        } else {
            const eur = response.data.EURBRL;
            texto = `💶 *Euro*\n\n🇧🇷 R$ ${parseFloat(eur.bid).toFixed(2)}\n📈 Máx: R$ ${parseFloat(eur.high).toFixed(2)}\n📉 Mín: R$ ${parseFloat(eur.low).toFixed(2)}`;
        }
        texto += `\n\n✨ ${CONFIG.CRIADOR}`;
        await sock.sendMessage(remetente, { text: texto });
    } catch (error) {
        await sock.sendMessage(remetente, { text: "❌ Erro!" });
    }
}

async function textoParaVoz(sock, remetente, texto) {
    try {
        const url = googleTTS.getAudioUrl(texto, { lang: 'pt-BR', slow: false, host: 'https://translate.google.com' });
        await sock.sendMessage(remetente, { audio: { url }, mimetype: 'audio/mpeg', ptt: false });
    } catch (error) {
        await sock.sendMessage(remetente, { text: "❌ Erro!" });
    }
}

async function calcular(sock, remetente, expressao) {
    try {
        const expr = expressao.replace(/[^0-9+\-*/.() ]/g, '').trim();
        const resultado = eval(expr);
        await sock.sendMessage(remetente, { text: `🧮 *Calculadora*\n\n${expr} = *${resultado}*\n\n✨ ${CONFIG.CRIADOR}` });
    } catch (error) {
        await sock.sendMessage(remetente, { text: "❌ Expressão inválida!" });
    }
}async function processarComando(sock, msg, remetente) {
    const textoCompleto = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || msg.message.videoMessage?.caption || '';
    const texto = textoCompleto.toLowerCase().trim();
    const args = texto.split(' ');
    const ehGrupo = remetente.endsWith('@g.us');

    if (texto === '!menu' || texto === '!menuia' || texto === '!help') {
        const menu = formatarMenu('MENU PRINCIPAL', ['!menuia', '!menudown', '!menulogos', '!menuedits', '!menuadm', '!menubn', '!menudono', '!menumemb', '!ferramentas', '!menufig', '!alteradores', '!menurpg', '!menuvip']);
        await sock.sendMessage(remetente, { text: menu });
        return true;
    }

    if (texto === '!info' || texto === '!sobre' || texto === '!criador') {
        const info = `╭┈⊰ 💜 『 *${CONFIG.BOT_NAME}* 』\n┊\n┊🤖 Nome: ${CONFIG.BOT_NAME}\n┊👤 Criador: Yanik Eusébio Uaite\n┊📅 Versão: 2.0.0\n┊💜 Status: Online 24/7\n┊\n╰─┈┈┈┈┈◜❁◞┈┈┈┈┈─╯\n✨ *${CONFIG.CRIADOR}* ✨`;
        await sock.sendMessage(remetente, { text: info });
        return true;
    }

    if ((texto === '!sticker' || texto === '!fig') && (msg.message.imageMessage || msg.message.videoMessage)) {
        await criarSticker(sock, msg, remetente);
        return true;
    }

    if (texto.startsWith('!play ')) { await baixarMusica(sock, remetente, textoCompleto.substring(6).trim()); return true; }
    if (texto.startsWith('!tiktok ')) { await baixarTikTok(sock, remetente, args[1]); return true; }
    if (texto.startsWith('!logo3d ')) { await criarLogo(sock, remetente, '3d', textoCompleto.substring(8).trim()); return true; }
    if (texto.startsWith('!logoneon ')) { await criarLogo(sock, remetente, 'neon', textoCompleto.substring(9).trim()); return true; }
    if (texto.startsWith('!logofogo ') || texto.startsWith('!logoflame ')) { await criarLogo(sock, remetente, 'fogo', textoCompleto.substring(10).trim()); return true; }
    if (texto.startsWith('!logogame ')) { await criarLogo(sock, remetente, 'game', textoCompleto.substring(9).trim()); return true; }
    if (texto.startsWith('!logometal ')) { await criarLogo(sock, remetente, 'metal', textoCompleto.substring(10).trim()); return true; }
    if (texto.startsWith('!clima ')) { await verClima(sock, remetente, textoCompleto.substring(7).trim()); return true; }
    if (texto.startsWith('!tradutor ')) { await traduzirTexto(sock, remetente, textoCompleto.substring(9).trim()); return true; }
    if (texto.startsWith('!calculadora ') || texto.startsWith('!calc ')) { await calcular(sock, remetente, textoCompleto.substring(texto.indexOf(' ') + 1)); return true; }
    if (texto === '!dolar') { await cotacaoMoeda(sock, remetente, 'dolar'); return true; }
    if (texto === '!euro') { await cotacaoMoeda(sock, remetente, 'euro'); return true; }
    if (texto.startsWith('!tts ') || texto.startsWith('!falar ')) { await textoParaVoz(sock, remetente, textoCompleto.substring(texto.indexOf(' ') + 1)); return true; }

    if (texto === '!menudown') { await sock.sendMessage(remetente, { text: formatarMenu('Downloads', ['!play [música]', '!tiktok [link]', '!instagram [link]']) }); return true; }
    if (texto === '!menulogos') { await sock.sendMessage(remetente, { text: formatarMenu('Logos', ['!logo3d [texto]', '!logoneon [texto]', '!logofogo [texto]', '!logogame [texto]', '!logometal [texto]']) }); return true; }
    if (texto === '!menufig') { await sock.sendMessage(remetente, { text: formatarMenu('Figurinhas', ['!sticker (marca img)', '!fig (marca img)']) }); return true; }
    if (texto === '!ferramentas') { await sock.sendMessage(remetente, { text: formatarMenu('Ferramentas', ['!clima [cidade]', '!tradutor [texto]', '!calculadora [conta]', '!dolar', '!euro', '!tts [texto]']) }); return true; }
    if (texto === '!alteradores') { await sock.sendMessage(remetente, { text: formatarMenu('Alteradores', ['!tts [texto]', '!falar [texto]']) }); return true; }
    if (texto === '!menuadm') { await sock.sendMessage(remetente, { text: formatarMenu('Admin', ['!add @pessoa', '!kick @pessoa', '!promover @pessoa', '!rebaixar @pessoa', '!fechargp', '!abrirgp', '!todos']) }); return true; }
    if (texto === '!menubn') { await sock.sendMessage(remetente, { text: formatarMenu('Banimentos', ['!ban @pessoa', '!unban @pessoa', '!mutar @pessoa', '!desmutar @pessoa', '!listaban', '!antilink ban/kick']) }); return true; }
    if (texto === '!menudono') { await sock.sendMessage(remetente, { text: formatarMenu('Dono', ['!status [texto]', '!status ver', '!status reset', '!addvip @pessoa [nivel] [dias]', '!removevip @pessoa', '!listavip', '!reiniciar', '!limparsessao']) }); return true; }if (texto === '!menuvip') {
    const vip = bancoVIP.get(remetente);
    if (!vip && remetente !== numeroDono) {
        await sock.sendMessage(remetente, { text: `╭┈⊰ 💜 『 *VIP* 』\n┊\n┊🌟 Seja VIP!\n┊\n┊🥉 Bronze - 7 dias\n┊🥈 Prata - 15 dias\n┊🥇 Ouro - 30 dias\n┊💎 Diamante - 60 dias\n┊👑 Lenda - 1 ano\n┊\n┊⚡ Vantagens:\n┊• Gerir grupos\n┊• Banir membros\n┊• Silenciar\n┊\n┊📝 Fale com o dono!\n┊\n╰─┈┈┈┈┈◜❁◞┈┈┈┈┈─╯\n✨ *${CONFIG.CRIADOR}* ✨` });
        return true;
    }
    const nivelVIP = vip ? NIVEIS_VIP[vip.nivel] : { nome: 'Dono 👑' };
    const restante = vip ? tempoRestanteVIP(remetente) : '∞ Eterno';
    await sock.sendMessage(remetente, { text: `╭┈⊰ 💜 『 *Meu VIP* 』\n┊\n┊⭐ Nível: ${nivelVIP.nome}\n┊⏰ Expira: ${restante}\n┊\n┊✅ Permissões:\n┊👮 Gestão: ${vip ? (nivelVIP.podeGerenciarGrupo ? 'Sim' : 'Não') : 'Sim'}\n┊🚫 Banir: ${vip ? (nivelVIP.podeBanir ? 'Sim' : 'Não') : 'Sim'}\n┊🔇 Silenciar: ${vip ? (nivelVIP.podeMutar ? 'Sim' : 'Não') : 'Sim'}\n┊\n╰─┈┈┈┈┈◜❁◞┈┈┈┈┈─╯\n✨ *${CONFIG.CRIADOR}* ✨` });
    return true;
}

if (texto.startsWith('!addvip ')) {
    if (remetente !== numeroDono) { await sock.sendMessage(remetente, { text: "❌ Só o dono!" }); return true; }
    const mencionado = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
    if (!mencionado) { await sock.sendMessage(remetente, { text: "❌ Marca a pessoa!" }); return true; }
    let nivel = 'bronze'; let dias = null;
    if (args.length >= 3 && NIVEIS_VIP[args[2]]) nivel = args[2].toLowerCase();
    if (args.length >= 4) dias = parseInt(args[3]);
    const resultado = adicionarVIP(mencionado, nivel, dias);
    await sock.sendMessage(remetente, { text: `✅ VIP Adicionado!\n\n👤 @${mencionado.split('@')[0]}\n⭐ ${resultado.nivel}\n📅 ${resultado.dias} dias\n⏰ Expira: ${resultado.expira}`, mentions: [mencionado] });
    return true;
}

if (texto.startsWith('!removevip ')) {
    if (remetente !== numeroDono) { await sock.sendMessage(remetente, { text: "❌ Só o dono!" }); return true; }
    const mencionado = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
    if (!mencionado) { await sock.sendMessage(remetente, { text: "❌ Marca a pessoa!" }); return true; }
    bancoVIP.delete(mencionado);
    await sock.sendMessage(remetente, { text: `✅ @${mencionado.split('@')[0]} removido!`, mentions: [mencionado] });
    return true;
}

if (texto === '!listavip') {
    if (bancoVIP.size === 0) { await sock.sendMessage(remetente, { text: "📝 Nenhum VIP!" }); return true; }
    let lista = "💜 *LISTA VIP* 💜\n\n";
    for (const [num, vip] of bancoVIP) { lista += `👤 @${num.split('@')[0]}\n⭐ ${NIVEIS_VIP[vip.nivel].nome}\n⏰ ${tempoRestanteVIP(num)}\n──────────────\n`; }
    lista += `\n✨ *${CONFIG.CRIADOR}* ✨`;
    await sock.sendMessage(remetente, { text: lista, mentions: Array.from(bancoVIP.keys()) });
    return true;
}

if (texto === '!meuvip') {
    if (remetente === numeroDono) { await sock.sendMessage(remetente, { text: `╭┈⊰ 💜 『 *Meu VIP* 』\n┊\n┊👑 Dono do Bot\n┊⏰ Eterno\n┊✅ Todas permissões\n┊\n╰─┈┈┈┈┈◜❁◞┈┈┈┈┈─╯\n✨ *${CONFIG.CRIADOR}* ✨` }); return true; }
    const vip = bancoVIP.get(remetente);
    if (!vip) { await sock.sendMessage(remetente, { text: `╭┈⊰ 💜 『 *Meu VIP* 』\n┊\n┊❌ Não és VIP!\n┊📝 Fale com o dono\n┊\n╰─┈┈┈┈┈◜❁◞┈┈┈┈┈─╯\n✨ *${CONFIG.CRIADOR}* ✨` }); return true; }
    const nivel = NIVEIS_VIP[vip.nivel];
    await sock.sendMessage(remetente, { text: `╭┈⊰ 💜 『 *Meu VIP* 』\n┊\n┊⭐ ${nivel.nome}\n┊⏰ ${tempoRestanteVIP(remetente)}\n┊📊 Cmds: ${vip.comandosHoje}/${nivel.comandosPorDia}\n┊\n┊✅ Gestão: ${nivel.podeGerenciarGrupo ? 'Sim' : 'Não'}\n┊🚫 Banir: ${nivel.podeBanir ? 'Sim' : 'Não'}\n┊🔇 Silenciar: ${nivel.podeMutar ? 'Sim' : 'Não'}\n┊\n╰─┈┈┈┈┈◜❁◞┈┈┈┈┈─╯\n✨ *${CONFIG.CRIADOR}* ✨` });
    return true;
}

if (remetente === numeroDono) {
    if (texto.startsWith('!status ')) {
        const novoStatus = textoCompleto.substring(8).trim();
        if (novoStatus === 'ver') { await sock.sendMessage(remetente, { text: `📱 Status: "${motivoAusencia || 'Online e disponível!'}"` }); }
        else if (novoStatus === 'reset') { motivoAusencia = null; await sock.sendMessage(remetente, { text: "✅ Status resetado!" }); }
        else { motivoAusencia = novoStatus; await sock.sendMessage(remetente, { text: `✅ Status: "${motivoAusencia}"` }); }
        return true;
    }
    if (texto === '!reiniciar') { await sock.sendMessage(remetente, { text: "🔄 Reiniciando..." }); process.exit(0); return true; }
    if (texto === '!limparsessao') { await sock.sendMessage(remetente, { text: "⚠️ Limpando sessão..." }); setTimeout(() => { fs.rmSync('sessao_ia', { recursive: true, force: true }); process.exit(0); }, 3000); return true; }
}    if (ehGrupo) {
        if (texto.startsWith('!antilink ')) {
            if (!podeGerenciarGrupo(remetente)) { await sock.sendMessage(remetente, { text: "❌ Só VIPs Ouro+!" }); return true; }
            const acao = args[1];
            if (['ban', 'kick', 'delete', 'warn'].includes(acao)) {
                if (!gruposConfig.has(remetente)) gruposConfig.set(remetente, {});
                gruposConfig.get(remetente).antiLink = acao;
                await sock.sendMessage(remetente, { text: `✅ Anti-link: ${acao.toUpperCase()}` });
            }
            return true;
        }

        if (texto.startsWith('!ban ')) {
            if (!podeBanir(remetente)) { await sock.sendMessage(remetente, { text: "❌ Só VIPs Ouro+!" }); return true; }
            const mencionado = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!mencionado) { await sock.sendMessage(remetente, { text: "❌ Marca a pessoa!" }); return true; }
            try {
                await sock.groupParticipantsUpdate(remetente, [mencionado], 'remove');
                if (!usuariosBanidos.has(remetente)) usuariosBanidos.set(remetente, []);
                usuariosBanidos.get(remetente).push({ numero: mencionado, data: Date.now() });
                await sock.sendMessage(remetente, { text: `🚫 @${mencionado.split('@')[0]} banido!`, mentions: [mencionado] });
            } catch (error) { await sock.sendMessage(remetente, { text: "❌ Erro! Bot precisa ser admin." }); }
            return true;
        }

        if (texto.startsWith('!mutar ')) {
            if (!podeMutar(remetente)) { await sock.sendMessage(remetente, { text: "❌ Só VIPs Prata+!" }); return true; }
            const mencionado = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            const duracao = parseInt(args[2]) || 10;
            if (!mencionado) { await sock.sendMessage(remetente, { text: "❌ Marca a pessoa!" }); return true; }
            if (!usuariosMutados.has(remetente)) usuariosMutados.set(remetente, new Map());
            usuariosMutados.get(remetente).set(mencionado, Date.now() + (duracao * 60 * 1000));
            await sock.sendMessage(remetente, { text: `🔇 @${mencionado.split('@')[0]} silenciado ${duracao}min!`, mentions: [mencionado] });
            return true;
        }

        if (texto === '!todos') {
            if (!podeGerenciarGrupo(remetente)) { await sock.sendMessage(remetente, { text: "❌ Só VIPs Ouro+!" }); return true; }
            try {
                const metadata = await sock.groupMetadata(remetente);
                await sock.sendMessage(remetente, { text: "📢 *ATENÇÃO TODOS!*", mentions: metadata.participants.map(p => p.id) });
            } catch (error) { await sock.sendMessage(remetente, { text: "❌ Erro!" }); }
            return true;
        }

        if (texto === '!fechargp' || texto === '!abrirgp') {
            if (!podeGerenciarGrupo(remetente)) { await sock.sendMessage(remetente, { text: "❌ Só VIPs Ouro+!" }); return true; }
            try {
                await sock.groupSettingUpdate(remetente, texto === '!fechargp' ? 'announcement' : 'not_announcement');
                await sock.sendMessage(remetente, { text: texto === '!fechargp' ? "🔒 Grupo fechado!" : "🔓 Grupo aberto!" });
            } catch (error) { await sock.sendMessage(remetente, { text: "❌ Erro!" }); }
            return true;
        }

        if (texto === '!infogp') {
            try {
                const metadata = await sock.groupMetadata(remetente);
                const config = gruposConfig.get(remetente);
                let vipsNoGrupo = [];
                for (const p of metadata.participants) {
                    if (p.id === numeroDono) vipsNoGrupo.push({ n: p.id, l: 'Dono 👑', r: '∞' });
                    else if (bancoVIP.has(p.id)) {
                        const r = tempoRestanteVIP(p.id);
                        if (r && r !== 'Expirado') vipsNoGrupo.push({ n: p.id, l: NIVEIS_VIP[bancoVIP.get(p.id).nivel].nome, r });
                    }
                }
                let info = `╭┈⊰ 💜 『 *Info do Grupo* 』\n┊📝 ${metadata.subject}\n┊👥 ${metadata.participants.length} membros\n┊🔒 Anti-link: ${config?.antiLink || 'Desativado'}\n┊💜 VIPs: ${vipsNoGrupo.length}\n`;
                vipsNoGrupo.slice(0, 5).forEach(v => { info += `┊${v.l} @${v.n.split('@')[0]} (${v.r})\n`; });
                info += `\n✨ *${CONFIG.CRIADOR}* ✨`;
                await sock.sendMessage(remetente, { text: info, mentions: vipsNoGrupo.map(v => v.n) });
            } catch (error) { await sock.sendMessage(remetente, { text: "❌ Erro!" }); }
            return true;
        }
    }

    return false;
}async function iniciarBot() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState('sessao_ia');
        
        const sock = makeWASocket({
            auth: state,
            logger: require('pino')({ level: 'silent' }),
            printQRInTerminal: false,
            connectTimeoutMs: 120000,
            keepAliveIntervalMs: CONFIG.KEEP_ALIVE,
            browser: [CONFIG.BOT_NAME, 'Chrome', '1.0.0'],
            markOnlineOnConnect: true,
            syncFullHistory: false
        });

        numeroDono = "258834788141@s.whatsapp.net";
        const NUMERO_BOT = "258840474014";
        
        console.log(`\n👑 Dono: Yanik (834788141)`);
        console.log(`📱 Bot: ${NUMERO_BOT}`);

        if (!sock.authState.creds.registered) {
            console.log('\n🔢 Gerando código de emparelhamento...\n');
            try {
                const code = await sock.requestPairingCode(NUMERO_BOT);
                console.log('============================================');
                console.log(`🔢 CÓDIGO: ${code}`);
                console.log('============================================');
                console.log(`📱 WhatsApp: ${NUMERO_BOT}`);
                console.log('📱 Aparelhos Conectados > Conectar aparelho');
                console.log('🔢 Digita o código acima');
                console.log('');
            } catch (err) {
                console.log('❌ Erro:', err.message);
                setTimeout(() => iniciarBot(), 10000);
                return;
            }
        }

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === 'close') {
                console.log(`❌ Conexão fechada`);
                setTimeout(() => iniciarBot(), 5000);
            }
            if (connection === 'open') {
                console.log('✅ WhatsApp conectado!');
                sock.sendMessage(numeroDono, { text: `╭┈⊰ 💜 『 *${CONFIG.BOT_NAME}* 』\n┊✅ Online 24/7!\n┊👑 Dono: Yanik\n┊Digita !menu\n╰─┈┈┈┈┈◜❁◞┈┈┈┈┈─╯\n\n✨ *${CONFIG.CRIADOR}* ✨` });
            }
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('messages.upsert', async (m) => {
            if (!m.messages?.length) return;
            const msg = m.messages[0];
            if (!msg.message || msg.key.fromMe || msg.key.remoteJid === 'status@broadcast') return;

            const agora = Math.floor(Date.now() / 1000);
            if (agora - msg.messageTimestamp > 120) return;

            const remetente = msg.key.remoteJid;
            const ehGrupo = remetente.endsWith('@g.us');
            
            let texto = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || msg.message.videoMessage?.caption;
            if (!texto && msg.message.stickerMessage) texto = "[Sticker]";
            if (!texto) return;

            console.log(`[${remetente.split('@')[0]}]: ${texto}`);

            if (texto.startsWith('!')) { if (await processarComando(sock, msg, remetente)) return; }
            if (ehGrupo && usuariosMutados.has(remetente) && usuariosMutados.get(remetente).get(remetente) > Date.now()) return;

            if (ehGrupo) {
                const cfg = gruposConfig.get(remetente);
                if (cfg?.antiLink && /https?:\/\//.test(texto) && !podeGerenciarGrupo(remetente)) {
                    await sock.sendMessage(remetente, { delete: msg.key });
                    return;
                }
            }

            if ((msg.message.imageMessage || msg.message.videoMessage) && ['sticker', 'fig'].includes(texto.toLowerCase())) {
                await criarSticker(sock, msg, remetente);
                return;
            }

            if (ehGrupo && !texto.toLowerCase().includes('nano') && !texto.toLowerCase().includes('bot')) return;

            adicionarAoHistorico(remetente, "user", texto);

            try {
                await sock.sendPresenceUpdate('composing', remetente);
                const chat = await groq.chat.completions.create({
                    messages: [{ role: "system", content: `Tu és o ${CONFIG.BOT_NAME}, criado pelo Yanik Eusébio Uaite. Amigável e direta. Status: "${motivoAusencia || 'Online'}"` }, ...historicoChats[remetente]],
                    model: "llama-3.1-8b-instant",
                    temperature: 0.7,
                    max_tokens: 200
                });
                const resposta = chat.choices[0]?.message?.content || "Pode repetir? 💜";
                adicionarAoHistorico(remetente, "assistant", resposta);
                await sock.sendPresenceUpdate('paused', remetente);
                await sock.sendMessage(remetente, { text: resposta }, { quoted: msg });
            } catch (e) {
                console.log("Erro IA:", e.message);
                await sock.sendPresenceUpdate('paused', remetente);
            }
        });
    } catch (erro) {
        console.error('Erro:', erro.message);
        setTimeout(() => iniciarBot(), 10000);
    }
}

process.on('uncaughtException', (err) => console.error('Erro:', err.message));
process.on('unhandledRejection', (reason) => console.error('Promise:', reason));
setInterval(() => console.log(`💜 Online: ${new Date().toLocaleString()}`), 300000);

console.log(`\n🤖 ${CONFIG.BOT_NAME} iniciando...`);
console.log(`👑 Dono: Yanik (834788141)`);
console.log(`✨ ${CONFIG.CRIADOR}\n`);
iniciarBot();