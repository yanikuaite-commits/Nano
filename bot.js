const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = require('@whiskeysockets/baileys');
const Groq = require('groq-sdk');
const fs = require('fs');
const http = require('http');
const axios = require('axios');
const googleTTS = require('google-tts-api');

const CONFIG = {
    BOT_NAME: "Nano bot 🤖",
    CRIADOR: "made by Yanik Eusébio Uaite"
};

const groq = new Groq({ apiKey: "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" });

let motivoAusencia = null;
let numeroDono = "258834788141@s.whatsapp.net";
const historicoChats = {};
const bancoVIP = new Map();

const NIVEIS_VIP = {
    bronze: { nome: 'Bronze 🥉', comandosPorDia: 20, podeGerenciar: false, podeBanir: false, podeMutar: false, dias: 7 },
    prata: { nome: 'Prata 🥈', comandosPorDia: 50, podeGerenciar: false, podeBanir: false, podeMutar: true, dias: 15 },
    ouro: { nome: 'Ouro 🥇', comandosPorDia: 100, podeGerenciar: true, podeBanir: true, podeMutar: true, dias: 30 },
    diamante: { nome: 'Diamante 💎', comandosPorDia: 200, podeGerenciar: true, podeBanir: true, podeMutar: true, dias: 60 },
    lenda: { nome: 'Lenda 👑', comandosPorDia: 999, podeGerenciar: true, podeBanir: true, podeMutar: true, dias: 365 }
};

const gruposConfig = new Map();
const usuariosMutados = new Map();

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<h1>💜 ${CONFIG.BOT_NAME}</h1><p>${CONFIG.CRIADOR}</p><p>🟢 Online</p>`);
});
server.listen(process.env.PORT || 3000);

function adicionarAoHistorico(chatId, role, content) {
    if (!historicoChats[chatId]) historicoChats[chatId] = [];
    historicoChats[chatId].push({ role, content });
    if (historicoChats[chatId].length > 20) historicoChats[chatId].shift();
}

function formatarMenu(titulo, comandos) {
    let menu = `╭┈⊰ 💜 『 *${CONFIG.BOT_NAME}* 』\n┊Olá!\n╰─┈┈┈┈┈◜❁◞┈┈┈┈┈─╯\n\n╭┈❁ *${titulo}*\n┊\n`;
    comandos.forEach(cmd => menu += `┊💜 ${cmd}\n`);
    menu += `╰─┈┈┈┈┈◜❁◞┈┈┈┈┈─╯\n\n✨ *${CONFIG.CRIADOR}* ✨`;
    return menu;
}

function tempoRestanteVIP(numero) {
    const vip = bancoVIP.get(numero);
    if (!vip) return null;
    const restante = vip.expiraEm - Date.now();
    if (restante <= 0) return 'Expirado';
    return `${Math.floor(restante / 86400000)}d ${Math.floor((restante % 86400000) / 3600000)}h`;
}

function podeGerenciar(numero) {
    if (numero === numeroDono) return true;
    const vip = bancoVIP.get(numero);
    return vip ? NIVEIS_VIP[vip.nivel].podeGerenciar : false;
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
}async function criarSticker(sock, msg, remetente) {
    try {
        let buffer;
        if (msg.message.imageMessage) buffer = await downloadMediaMessage(msg, 'buffer', {});
        else if (msg.message.videoMessage) {
            if (msg.message.videoMessage.seconds > 10) {
                await sock.sendMessage(remetente, { text: "❌ Máximo 10 segundos!" });
                return;
            }
            buffer = await downloadMediaMessage(msg, 'buffer', {});
        } else {
            await sock.sendMessage(remetente, { text: "❌ Envia imagem/vídeo!" });
            return;
        }
        await sock.sendMessage(remetente, { sticker: buffer });
    } catch (e) {
        await sock.sendMessage(remetente, { text: "❌ Erro!" });
    }
}

async function baixarMusica(sock, remetente, query) {
    try {
        const res = await axios.get(`https://api.zenkey.ml/api/downloader/ytplay?query=${encodeURIComponent(query)}`);
        if (res.data?.url) await sock.sendMessage(remetente, { audio: { url: res.data.url }, mimetype: 'audio/mpeg' });
        else await sock.sendMessage(remetente, { text: "❌ Não encontrada!" });
    } catch (e) { await sock.sendMessage(remetente, { text: "❌ Erro!" }); }
}

async function criarLogo(sock, remetente, tipo, texto) {
    try {
        const tipos = { '3d': '3dlogo', 'neon': 'neonlogo', 'fogo': 'flamelogo', 'game': 'gamelogo', 'metal': 'metallogo' };
        const endpoint = tipos[tipo] || '3dlogo';
        const url = `https://api.zenkey.ml/api/maker/${endpoint}?text=${encodeURIComponent(texto)}`;
        await sock.sendMessage(remetente, { image: { url }, caption: `✅ Logo ${tipo}: "${texto}"` });
    } catch (e) { await sock.sendMessage(remetente, { text: "❌ Erro!" }); }
}

async function verClima(sock, remetente, cidade) {
    try {
        const res = await axios.get(`https://wttr.in/${encodeURIComponent(cidade)}?format=%C+%t&lang=pt`);
        await sock.sendMessage(remetente, { text: `🌤️ *${cidade}*\n\n${res.data.trim()}` });
    } catch (e) { await sock.sendMessage(remetente, { text: "❌ Erro!" }); }
}

async function traduzir(sock, remetente, texto) {
    try {
        const res = await axios.get(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=pt&dt=t&q=${encodeURIComponent(texto)}`);
        await sock.sendMessage(remetente, { text: `📝 ${res.data[0][0][0]}` });
    } catch (e) { await sock.sendMessage(remetente, { text: "❌ Erro!" }); }
}

async function cotacao(sock, remetente, moeda) {
    try {
        const res = await axios.get('https://economia.awesomeapi.com.br/json/last/USD-BRL,EUR-BRL');
        const data = moeda === 'dolar' ? res.data.USDBRL : res.data.EURBRL;
        await sock.sendMessage(remetente, { text: `${moeda === 'dolar' ? '💵 Dólar' : '💶 Euro'}\n\nR$ ${parseFloat(data.bid).toFixed(2)}` });
    } catch (e) { await sock.sendMessage(remetente, { text: "❌ Erro!" }); }
}

async function tts(sock, remetente, texto) {
    try {
        const url = googleTTS.getAudioUrl(texto, { lang: 'pt-BR', slow: false });
        await sock.sendMessage(remetente, { audio: { url }, mimetype: 'audio/mpeg' });
    } catch (e) { await sock.sendMessage(remetente, { text: "❌ Erro!" }); }
}async function processarComando(sock, msg, remetente) {
    const textoCompleto = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || msg.message.videoMessage?.caption || '';
    const texto = textoCompleto.toLowerCase().trim();
    const args = texto.split(' ');
    const ehGrupo = remetente.endsWith('@g.us');

    if (texto === '!menu' || texto === '!menuia') {
        await sock.sendMessage(remetente, { text: formatarMenu('MENU PRINCIPAL', ['!menuia', '!menudown', '!menulogos', '!menuadm', '!menubn', '!menudono', '!ferramentas', '!menufig', '!menuvip']) });
        return true;
    }

    if (texto === '!info') {
        await sock.sendMessage(remetente, { text: `╭┈⊰ 💜 『 *${CONFIG.BOT_NAME}* 』\n┊🤖 ${CONFIG.BOT_NAME}\n┊👤 Yanik Eusébio Uaite\n┊💜 Online 24/7\n╰─┈┈┈┈┈◜❁◞┈┈┈┈┈─╯\n✨ *${CONFIG.CRIADOR}* ✨` });
        return true;
    }

    if ((texto === '!sticker' || texto === '!fig') && (msg.message.imageMessage || msg.message.videoMessage)) {
        await criarSticker(sock, msg, remetente);
        return true;
    }

    if (texto.startsWith('!play ')) { await baixarMusica(sock, remetente, textoCompleto.substring(6).trim()); return true; }
    if (texto.startsWith('!logo3d ')) { await criarLogo(sock, remetente, '3d', textoCompleto.substring(8).trim()); return true; }
    if (texto.startsWith('!logoneon ')) { await criarLogo(sock, remetente, 'neon', textoCompleto.substring(9).trim()); return true; }
    if (texto.startsWith('!logofogo ')) { await criarLogo(sock, remetente, 'fogo', textoCompleto.substring(10).trim()); return true; }
    if (texto.startsWith('!clima ')) { await verClima(sock, remetente, textoCompleto.substring(7).trim()); return true; }
    if (texto.startsWith('!tradutor ')) { await traduzir(sock, remetente, textoCompleto.substring(9).trim()); return true; }
    if (texto.startsWith('!calc ')) {
        try {
            const r = eval(textoCompleto.substring(6).replace(/[^0-9+\-*/.() ]/g, ''));
            await sock.sendMessage(remetente, { text: `🧮 ${r}` });
        } catch (e) { await sock.sendMessage(remetente, { text: "❌ Erro!" }); }
        return true;
    }
    if (texto === '!dolar') { await cotacao(sock, remetente, 'dolar'); return true; }
    if (texto === '!euro') { await cotacao(sock, remetente, 'euro'); return true; }
    if (texto.startsWith('!tts ') || texto.startsWith('!falar ')) { await tts(sock, remetente, textoCompleto.substring(texto.indexOf(' ') + 1)); return true; }

    if (texto === '!menudown') { await sock.sendMessage(remetente, { text: formatarMenu('Downloads', ['!play [música]', '!tiktok [link]']) }); return true; }
    if (texto === '!menulogos') { await sock.sendMessage(remetente, { text: formatarMenu('Logos', ['!logo3d [texto]', '!logoneon [texto]', '!logofogo [texto]']) }); return true; }
    if (texto === '!menufig') { await sock.sendMessage(remetente, { text: formatarMenu('Figurinhas', ['!sticker (marca img)', '!fig (marca img)']) }); return true; }
    if (texto === '!ferramentas') { await sock.sendMessage(remetente, { text: formatarMenu('Ferramentas', ['!clima [cidade]', '!tradutor [texto]', '!calc [conta]', '!dolar', '!euro', '!tts [texto]']) }); return true; }
    if (texto === '!menuadm') { await sock.sendMessage(remetente, { text: formatarMenu('Admin', ['!ban @pessoa', '!mutar @pessoa', '!todos', '!fechargp', '!abrirgp']) }); return true; }
    if (texto === '!menubn') { await sock.sendMessage(remetente, { text: formatarMenu('Banimentos', ['!ban @pessoa', '!mutar @pessoa 10', '!antilink ban']) }); return true; }
    if (texto === '!menudono') { await sock.sendMessage(remetente, { text: formatarMenu('Dono', ['!status [texto]', '!addvip @pessoa ouro 30', '!removevip @pessoa', '!listavip']) }); return true; }

    if (texto === '!menuvip') {
        const vip = bancoVIP.get(remetente);
        if (!vip && remetente !== numeroDono) {
            await sock.sendMessage(remetente, { text: `💜 *VIP*\n\n🌟 Seja VIP!\n🥉 Bronze - 7d\n🥈 Prata - 15d\n🥇 Ouro - 30d\n💎 Diamante - 60d\n👑 Lenda - 1 ano\n\n📝 Fale com o dono!` });
            return true;
        }
        const n = vip ? NIVEIS_VIP[vip.nivel] : { nome: 'Dono 👑' };
        const r = vip ? tempoRestanteVIP(remetente) : '∞';
        await sock.sendMessage(remetente, { text: `💜 *Meu VIP*\n\n⭐ ${n.nome}\n⏰ ${r}\n👮 Gestão: ${vip ? (n.podeGerenciar ? 'Sim' : 'Não') : 'Sim'}\n🚫 Banir: ${vip ? (n.podeBanir ? 'Sim' : 'Não') : 'Sim'}` });
        return true;
    }

    if (texto.startsWith('!addvip ') && remetente === numeroDono) {
        const m = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
        if (!m) { await sock.sendMessage(remetente, { text: "❌ Marca a pessoa!" }); return true; }
        let nivel = 'bronze', dias = null;
        if (args.length >= 3 && NIVEIS_VIP[args[2]]) nivel = args[2];
        if (args.length >= 4) dias = parseInt(args[3]);
        const d = dias || NIVEIS_VIP[nivel].dias;
        bancoVIP.set(m, { nivel, expiraEm: Date.now() + (d * 86400000) });
        await sock.sendMessage(remetente, { text: `✅ VIP ${NIVEIS_VIP[nivel].nome} por ${d} dias!`, mentions: [m] });
        return true;
    }

    if (texto.startsWith('!removevip ') && remetente === numeroDono) {
        const m = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
        if (m) { bancoVIP.delete(m); await sock.sendMessage(remetente, { text: "✅ Removido!", mentions: [m] }); }
        return true;
    }

    if (texto === '!listavip') {
        if (bancoVIP.size === 0) { await sock.sendMessage(remetente, { text: "📝 Nenhum VIP!" }); return true; }
        let lista = "💜 *LISTA VIP*\n\n";
        for (const [num, vip] of bancoVIP) lista += `👤 @${num.split('@')[0]} - ${NIVEIS_VIP[vip.nivel].nome} (${tempoRestanteVIP(num)})\n`;
        await sock.sendMessage(remetente, { text: lista, mentions: Array.from(bancoVIP.keys()) });
        return true;
    }

    if (remetente === numeroDono && texto.startsWith('!status ')) {
        const s = textoCompleto.substring(8).trim();
        if (s === 'ver') await sock.sendMessage(remetente, { text: `📱 ${motivoAusencia || 'Online'}` });
        else if (s === 'reset') { motivoAusencia = null; await sock.sendMessage(remetente, { text: "✅ Reset!" }); }
        else { motivoAusencia = s; await sock.sendMessage(remetente, { text: `✅ ${s}` }); }
        return true;
    }

    if (ehGrupo) {
        if (texto.startsWith('!antilink ') && podeGerenciar(remetente)) {
            const a = args[1];
            if (['ban', 'kick', 'delete'].includes(a)) {
                if (!gruposConfig.has(remetente)) gruposConfig.set(remetente, {});
                gruposConfig.get(remetente).antiLink = a;
                await sock.sendMessage(remetente, { text: `✅ Anti-link: ${a}` });
            }
            return true;
        }

        if (texto.startsWith('!ban ') && podeBanir(remetente)) {
            const m = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (m) { try { await sock.groupParticipantsUpdate(remetente, [m], 'remove'); await sock.sendMessage(remetente, { text: `🚫 Banido!`, mentions: [m] }); } catch (e) { await sock.sendMessage(remetente, { text: "❌ Bot precisa ser admin!" }); } }
            return true;
        }

        if (texto.startsWith('!mutar ') && podeMutar(remetente)) {
            const m = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            const d = parseInt(args[2]) || 10;
            if (m) {
                if (!usuariosMutados.has(remetente)) usuariosMutados.set(remetente, new Map());
                usuariosMutados.get(remetente).set(m, Date.now() + (d * 60000));
                await sock.sendMessage(remetente, { text: `🔇 ${d}min`, mentions: [m] });
            }
            return true;
        }

        if (texto === '!todos' && podeGerenciar(remetente)) {
            try {
                const meta = await sock.groupMetadata(remetente);
                await sock.sendMessage(remetente, { text: "📢 TODOS!", mentions: meta.participants.map(p => p.id) });
            } catch (e) { await sock.sendMessage(remetente, { text: "❌ Erro!" }); }
            return true;
        }

        if ((texto === '!fechargp' || texto === '!abrirgp') && podeGerenciar(remetente)) {
            try {
                await sock.groupSettingUpdate(remetente, texto === '!fechargp' ? 'announcement' : 'not_announcement');
                await sock.sendMessage(remetente, { text: texto === '!fechargp' ? "🔒 Fechado!" : "🔓 Aberto!" });
            } catch (e) { await sock.sendMessage(remetente, { text: "❌ Erro!" }); }
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
            keepAliveIntervalMs: 30000,
            browser: [CONFIG.BOT_NAME, 'Chrome', '1.0.0'],
            markOnlineOnConnect: true,
            syncFullHistory: false
        });

        console.log(`\n👑 Dono: Yanik (834788141)`);

        if (!sock.authState.creds.registered) {
            console.log('\n🔢 Gerando código...\n');
            try {
                const code = await sock.requestPairingCode("258840474014");
                console.log('========================');
                console.log(`🔢 CÓDIGO: ${code}`);
                console.log('========================');
                console.log('📱 Abre WhatsApp no 840474014');
                console.log('📱 Aparelhos Conectados > Conectar');
                console.log('🔢 Digita o código acima\n');
            } catch (err) {
                console.log('❌ Erro:', err.message);
                setTimeout(() => iniciarBot(), 10000);
                return;
            }
        }

        sock.ev.on('connection.update', (update) => {
            const { connection } = update;
            if (connection === 'close') setTimeout(() => iniciarBot(), 5000);
            if (connection === 'open') {
                console.log('✅ Conectado!');
                sock.sendMessage(numeroDono, { text: `╭┈⊰ 💜 『 *${CONFIG.BOT_NAME}* 』\n┊✅ Online 24/7!\n┊👑 Dono: Yanik\n┊Digita !menu\n╰─┈┈┈┈┈◜❁◞┈┈┈┈┈─╯\n\n✨ *${CONFIG.CRIADOR}* ✨` });
            }
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('messages.upsert', async (m) => {
            if (!m.messages?.length) return;
            const msg = m.messages[0];
            if (!msg.message || msg.key.fromMe) return;

            const agora = Math.floor(Date.now() / 1000);
            if (agora - msg.messageTimestamp > 120) return;

            const remetente = msg.key.remoteJid;
            const ehGrupo = remetente.endsWith('@g.us');
            
            let texto = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || msg.message.videoMessage?.caption;
            if (!texto && msg.message.stickerMessage) texto = "[Sticker]";
            if (!texto) return;

            if (texto.startsWith('!')) { if (await processarComando(sock, msg, remetente)) return; }

            if (ehGrupo && usuariosMutados.has(remetente)) {
                const ate = usuariosMutados.get(remetente).get(remetente);
                if (ate && Date.now() < ate) return;
            }

            if (ehGrupo) {
                const cfg = gruposConfig.get(remetente);
                if (cfg?.antiLink && /https?:\/\//.test(texto) && !podeGerenciar(remetente)) {
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
                    messages: [{ role: "system", content: `És o ${CONFIG.BOT_NAME} do Yanik Eusébio Uaite. Amigável e direta. Status: "${motivoAusencia || 'Online'}"` }, ...historicoChats[remetente]],
                    model: "llama-3.1-8b-instant",
                    temperature: 0.7,
                    max_tokens: 200
                });
                const resposta = chat.choices[0]?.message?.content || "Pode repetir? 💜";
                adicionarAoHistorico(remetente, "assistant", resposta);
                await sock.sendMessage(remetente, { text: resposta }, { quoted: msg });
            } catch (e) {
                await sock.sendMessage(remetente, { text: "❌ Erro na IA!" });
            }
        });
    } catch (erro) {
        setTimeout(() => iniciarBot(), 10000);
    }
}

console.log(`\n🤖 ${CONFIG.BOT_NAME} iniciando...\n`);
iniciarBot();