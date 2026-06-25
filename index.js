const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = require('@whiskeysockets/baileys');
const Groq = require('groq-sdk');
const readline = require('readline');
const fs = require('fs');
const http = require('http');
const axios = require('axios');
const googleTTS = require('google-tts-api');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

// ==================== CONFIGURAÇÕES ====================
const CONFIG = {
    MAX_RECONEXOES: 1000,
    TEMPO_RECONEXAO: 5000,
    KEEP_ALIVE: 30000,
    BOT_NAME: "Nano bot 🤖",
    CRIADOR: "made by Yanik Eusébio Uaite"
};

// TUA CHAVE DA GROQ
const groq = new Groq({
    apiKey: "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"
});

// ==================== VARIÁVEIS GLOBAIS ====================
let tentativasReconexao = 0;
let motivoAusencia = null;
let numeroDono = null;
const historicoChats = {};

// ==================== BANCO DE DADOS VIP ====================
const bancoVIP = new Map();

// ==================== NÍVEIS VIP ====================
const NIVEIS_VIP = {
    bronze: { nome: 'Bronze 🥉', comandosPorDia: 20, podeGerenciarGrupo: false, podeBanir: false, podeMutar: false, duracaoPadrao: 7 },
    prata: { nome: 'Prata 🥈', comandosPorDia: 50, podeGerenciarGrupo: false, podeBanir: false, podeMutar: true, duracaoPadrao: 15 },
    ouro: { nome: 'Ouro 🥇', comandosPorDia: 100, podeGerenciarGrupo: true, podeBanir: true, podeMutar: true, duracaoPadrao: 30 },
    diamante: { nome: 'Diamante 💎', comandosPorDia: 200, podeGerenciarGrupo: true, podeBanir: true, podeMutar: true, duracaoPadrao: 60 },
    lenda: { nome: 'Lenda 👑', comandosPorDia: 999, podeGerenciarGrupo: true, podeBanir: true, podeMutar: true, duracaoPadrao: 365 }
};

// ==================== CONFIGURAÇÕES DE GRUPOS ====================
const gruposConfig = new Map();
const usuariosBanidos = new Map();
const usuariosMutados = new Map();

// ==================== SERVIDOR HTTP ====================
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!DOCTYPE html><html><head><title>${CONFIG.BOT_NAME}</title><meta charset="UTF-8"><style>body{background:#1a1a2e;color:#e94560;text-align:center;padding:50px;font-family:Arial;}h1{font-size:2.5em;}.pulse{animation:pulse 2s infinite;}@keyframes pulse{0%{opacity:1}50%{opacity:0.5}100%{opacity:1}}</style></head><body><h1>💜 ${CONFIG.BOT_NAME}</h1><p>${CONFIG.CRIADOR}</p><div class="pulse">🟢 Online 24/7</div><script>setInterval(()=>{fetch('/ping')},240000)</script></body></html>`);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Health check: http://0.0.0.0:${PORT}`);
});

// ==================== FUNÇÕES UTILITÁRIAS ====================
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
}// ==================== FUNÇÕES VIP ====================
function adicionarVIP(numero, nivel = 'bronze', dias = null) {
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
}

// ==================== STICKER ====================
async function criarSticker(sock, msg, remetente) {
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
        console.log("✅ Sticker criado!");
    } catch (erro) {
        await sock.sendMessage(remetente, { text: "❌ Erro ao criar sticker!" });
    }
}

// ==================== DOWNLOADS ====================
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
}

// ==================== LOGOS ====================
async function criarLogo(sock, remetente, tipo, texto) {
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

// ==================== FERRAMENTAS ====================
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
}// ==================== PROCESSAMENTO DE COMANDOS ====================

async function processarComando(sock, msg, remetente) {
    const textoCompleto = msg.message.conversation || 
                          msg.message.extendedTextMessage?.text || 
                          msg.message.imageMessage?.caption ||
                          msg.message.videoMessage?.caption || '';
    
    const texto = textoCompleto.toLowerCase().trim();
    const args = texto.split(' ');
    const ehGrupo = remetente.endsWith('@g.us');

    // ============= MENUS =============
    if (texto === '!menu' || texto === '!menuia' || texto === '!help') {
        const menu = formatarMenu('MENU PRINCIPAL', [
            '!menuia', '!menudown', '!menulogos', '!menuedits',
            '!menuadm', '!menubn', '!menudono', '!menumemb',
            '!ferramentas', '!menufig', '!alteradores', '!menurpg', '!menuvip'
        ]);
        await sock.sendMessage(remetente, { text: menu });
        return true;
    }

    if (texto === '!info' || texto === '!sobre' || texto === '!criador') {
        const info = `╭┈⊰ 💜 『 *${CONFIG.BOT_NAME}* 』\n┊\n┊🤖 Nome: ${CONFIG.BOT_NAME}\n┊👤 Criador: Yanik Eusébio Uaite\n┊📅 Versão: 2.0.0\n┊💜 Status: Online 24/7\n┊\n╰─┈┈┈┈┈◜❁◞┈┈┈┈┈─╯\n✨ *${CONFIG.CRIADOR}* ✨`;
        await sock.sendMessage(remetente, { text: info });
        return true;
    }

    // ============= STICKER =============
    if ((texto === '!sticker' || texto === '!fig') && 
        (msg.message.imageMessage || msg.message.videoMessage)) {
        await criarSticker(sock, msg, remetente);
        return true;
    }

    // ============= DOWNLOADS =============
    if (texto.startsWith('!play ')) {
        await baixarMusica(sock, remetente, textoCompleto.substring(6).trim());
        return true;
    }

    if (texto.startsWith('!tiktok ')) {
        await baixarTikTok(sock, remetente, args[1]);
        return true;
    }

    // ============= LOGOS =============
    if (texto.startsWith('!logo3d ')) {
        await criarLogo(sock, remetente, '3d', textoCompleto.substring(8).trim());
        return true;
    }

    if (texto.startsWith('!logoneon ')) {
        await criarLogo(sock, remetente, 'neon', textoCompleto.substring(9).trim());
        return true;
    }

    if (texto.startsWith('!logofogo ') || texto.startsWith('!logoflame ')) {
        await criarLogo(sock, remetente, 'fogo', textoCompleto.substring(10).trim());
        return true;
    }

    if (texto.startsWith('!logogame ')) {
        await criarLogo(sock, remetente, 'game', textoCompleto.substring(9).trim());
        return true;
    }

    if (texto.startsWith('!logometal ')) {
        await criarLogo(sock, remetente, 'metal', textoCompleto.substring(10).trim());
        return true;
    }

    // ============= FERRAMENTAS =============
    if (texto.startsWith('!clima ')) {
        await verClima(sock, remetente, textoCompleto.substring(7).trim());
        return true;
    }

    if (texto.startsWith('!tradutor ')) {
        await traduzirTexto(sock, remetente, textoCompleto.substring(9).trim());
        return true;
    }

    if (texto.startsWith('!calculadora ') || texto.startsWith('!calc ')) {
        await calcular(sock, remetente, textoCompleto.substring(texto.indexOf(' ') + 1));
        return true;
    }

    if (texto === '!dolar') {
        await cotacaoMoeda(sock, remetente, 'dolar');
        return true;
    }

    if (texto === '!euro') {
        await cotacaoMoeda(sock, remetente, 'euro');
        return true;
    }

    if (texto.startsWith('!tts ') || texto.startsWith('!falar ')) {
        await textoParaVoz(sock, remetente, textoCompleto.substring(texto.indexOf(' ') + 1));
        return true;
    }

    // ============= SUBMENUS =============
    if (texto === '!menudown') {
        const menu = formatarMenu('Downloads', ['!play [música]', '!tiktok [link]', '!instagram [link]']);
        await sock.sendMessage(remetente, { text: menu });
        return true;
    }

    if (texto === '!menulogos') {
        const menu = formatarMenu('Logos', ['!logo3d [texto]', '!logoneon [texto]', '!logofogo [texto]', '!logogame [texto]', '!logometal [texto]']);
        await sock.sendMessage(remetente, { text: menu });
        return true;
    }

    if (texto === '!menufig') {
        const menu = formatarMenu('Figurinhas', ['!sticker (marca img)', '!fig (marca img)']);
        await sock.sendMessage(remetente, { text: menu });
        return true;
    }

    if (texto === '!ferramentas') {
        const menu = formatarMenu('Ferramentas', ['!clima [cidade]', '!tradutor [texto]', '!calculadora [conta]', '!dolar', '!euro', '!tts [texto]']);
        await sock.sendMessage(remetente, { text: menu });
        return true;
    }

    if (texto === '!alteradores') {
        const menu = formatarMenu('Alteradores', ['!tts [texto]', '!falar [texto]']);
        await sock.sendMessage(remetente, { text: menu });
        return true;
    }

    if (texto === '!menuadm') {
        const menu = formatarMenu('Admin', ['!add @pessoa', '!kick @pessoa', '!promover @pessoa', '!rebaixar @pessoa', '!fechargp', '!abrirgp', '!todos']);
        await sock.sendMessage(remetente, { text: menu });
        return true;
    }

    if (texto === '!menubn') {
        const menu = formatarMenu('Banimentos', ['!ban @pessoa', '!unban @pessoa', '!mutar @pessoa', '!desmutar @pessoa', '!listaban', '!antilink ban/kick']);
        await sock.sendMessage(remetente, { text: menu });
        return true;
    }

    if (texto === '!menudono') {
        const menu = formatarMenu('Dono', ['!status [texto]', '!status ver', '!status reset', '!addvip @pessoa [nivel] [dias]', '!removevip @pessoa', '!listavip', '!reiniciar', '!limparsessao']);
        await sock.sendMessage(remetente, { text: menu });
        return true;
    }// ==================== INICIAR BOT ====================

async function iniciarBot() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState('sessao_ia');
        
        const sock = makeWASocket({
            auth: state,
            logger: require('pino')({ level: 'silent' }),
            printQRInTerminal: false,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: CONFIG.KEEP_ALIVE,
            browser: [CONFIG.BOT_NAME, 'Chrome', '1.0.0'],
            markOnlineOnConnect: true,
            syncFullHistory: false
        });

        // ============= DONO CONFIGURADO AQUI =============
        // Número do dono: 834788141
        // Número de hospedagem: 840474014
        
        if (!sock.authState.creds.registered) {
            console.log('\n[INFO] Gerando código de emparelhamento...');
            
            // Usa o número de hospedagem automaticamente
            const numHospedagem = "258840474014"; // Número que vai rodar o bot
            
            try {
                const code = await sock.requestPairingCode(numHospedagem);
                console.log(`\n👉 O TEU CÓDIGO É: ${code}\n`);
                
                // Define o DONO automaticamente
                numeroDono = "258834788141@s.whatsapp.net"; // TEU NÚMERO PESSOAL
                console.log(`👑 Dono: ${numeroDono.split('@')[0]}`);
                console.log(`📱 Hospedagem: ${numHospedagem}`);
                
            } catch (err) {
                console.log("\n❌ Erro:", err.message);
                process.exit(1);
            }
        } else {
            // Se já está registado, define o dono
            numeroDono = "258834788141@s.whatsapp.net"; // TEU NÚMERO PESSOAL
            console.log(`👑 Dono: ${numeroDono.split('@')[0]}`);
            console.log(`📱 Bot rodando em: ${sock.user.id.split(':')[0]}`);
        }

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === 'close') {
                const codigoErro = lastDisconnect?.error?.output?.statusCode;
                console.log(`❌ Conexão fechada. Código: ${codigoErro}`);
                if (codigoErro === DisconnectReason.loggedOut) {
                    console.log('⚠️ Sessão expirada!');
                    process.exit(1);
                }
                if (tentativasReconexao < CONFIG.MAX_RECONEXOES) {
                    tentativasReconexao++;
                    console.log(`🔄 Reconectando... ${tentativasReconexao}/${CONFIG.MAX_RECONEXOES}`);
                    setTimeout(() => iniciarBot(), CONFIG.TEMPO_RECONEXAO);
                }
            }
            if (connection === 'open') {
                tentativasReconexao = 0;
                console.log(`\n💜 ${CONFIG.BOT_NAME} Online!`);
                console.log(`👑 Dono: Yanik (258834788141)`);
                console.log(`✨ ${CONFIG.CRIADOR}\n`);
                
                // Mensagem de boas-vindas para o DONO
                sock.sendMessage(numeroDono, { 
                    text: `╭┈⊰ 💜 『 *${CONFIG.BOT_NAME}* 』\n┊Bot iniciado com sucesso!\n┊👑 Dono: Yanik\n┊📱 Número: 834788141\n┊Digita !menu para começar!\n╰─┈┈┈┈┈◜❁◞┈┈┈┈┈─╯\n\n✨ *${CONFIG.CRIADOR}* ✨`
                });
            }
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('messages.upsert', async (m) => {
            if (!m.messages || m.messages.length === 0) return;
            const msg = m.messages[0];
            if (!msg.message) return; 
            if (msg.key.fromMe || msg.key.remoteJid === 'status@broadcast') return;

            const tempoMensagem = msg.messageTimestamp; 
            const tempoAtual = Math.floor(Date.now() / 1000);
            if (tempoAtual - tempoMensagem > 120) return; 

            const remetente = msg.key.remoteJid;
            const ehGrupo = remetente.endsWith('@g.us');
            
            let textoRecebido = msg.message.conversation || 
                                msg.message.extendedTextMessage?.text || 
                                msg.message.imageMessage?.caption || 
                                msg.message.videoMessage?.caption;

            if (!textoRecebido && msg.message.stickerMessage) {
                textoRecebido = "[Sticker/Figurinha]";
            }
                                 
            if (!textoRecebido) return;

            console.log(`[${remetente.split('@')[0]}]: ${textoRecebido}`);

            if (textoRecebido.startsWith('!')) {
                const comandoProcessado = await processarComando(sock, msg, remetente);
                if (comandoProcessado) return;
            }

            if (ehGrupo && usuariosMutados.has(remetente)) {
                const mutadoAte = usuariosMutados.get(remetente).get(remetente);
                if (mutadoAte && Date.now() < mutadoAte) return;
            }

            if (ehGrupo) {
                const config = gruposConfig.get(remetente);
                if (config?.antiLink) {
                    const regexLink = /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&\/=]*)/gi;
                    if (regexLink.test(textoRecebido) && !podeGerenciarGrupo(remetente)) {
                        await sock.sendMessage(remetente, { delete: msg.key });
                        await sock.sendMessage(remetente, { text: `⚠️ @${remetente.split('@')[0]} link detectado!`, mentions: [remetente] });
                        return;
                    }
                }
            }

            if ((msg.message.imageMessage || msg.message.videoMessage) && 
                (textoRecebido.toLowerCase() === 'sticker' || textoRecebido.toLowerCase() === 'fig')) {
                await criarSticker(sock, msg, remetente);
                return;
            }

            if (ehGrupo) {
                const textoMinusculo = textoRecebido.toLowerCase();
                if (!textoMinusculo.includes('nano') && !textoMinusculo.includes('bot')) return;
            }

            adicionarAoHistorico(remetente, "user", textoRecebido);

            const systemPrompt = {
                role: "system",
                content: `Tu és o ${CONFIG.BOT_NAME}, criado pelo Yanik Eusébio Uaite. És amigável, direta e usas poucos emojis. Status: "${motivoAusencia || 'Online e disponível!'}"`
            };

            try {
                await sock.sendPresenceUpdate('composing', remetente);
                const chatCompletion = await groq.chat.completions.create({
                    messages: [systemPrompt, ...historicoChats[remetente]],
                    model: "llama-3.1-8b-instant",
                    temperature: 0.7,
                    max_tokens: 200
                });

                const resposta = chatCompletion.choices[0]?.message?.content || "Pode repetir? 💜";
                adicionarAoHistorico(remetente, "assistant", resposta);
                await sock.sendPresenceUpdate('paused', remetente);
                await sock.sendMessage(remetente, { text: resposta }, { quoted: msg });

            } catch (e) {
                console.log("Erro IA:", e.message);
                await sock.sendPresenceUpdate('paused', remetente);
            }
        });

    } catch (erro) {
        console.error('Erro crítico:', erro);
        setTimeout(() => iniciarBot(), 10000);
    }
}

process.on('uncaughtException', (err) => console.error('Erro:', err));
process.on('unhandledRejection', (reason) => console.error('Promise:', reason));

setInterval(() => {
    console.log(`💜 ${CONFIG.BOT_NAME} - Online:`, new Date().toLocaleString());
}, 300000);

console.log(`\n🤖 ${CONFIG.BOT_NAME} iniciando...`);
console.log(`👑 Dono: Yanik (258834788141)`);
console.log(`📱 Hospedagem: 258840474014`);
console.log(`✨ ${CONFIG.CRIADOR}\n`);
iniciarBot();