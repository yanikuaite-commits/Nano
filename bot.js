const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    makeCacheableSignalKeyStore 
} = require('@whiskeysockets/baileys');
const Groq = require('groq-sdk');
const pino = require('pino');
const http = require('http');

// ==========================================
// 1. CONFIGURAÇÕES PRINCIPAIS
// ==========================================
const CONFIG = {
    botName: "Nano Bot 🤖",
    creator: "Yanik Eusébio Uaite",
    ownerId: "275381038891241",
    ownerNumber: "834788141",
    botNumber: "258840474014",
    prefix: "!"
};

const groq = new Groq({ 
    apiKey: "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" 
});

// ==========================================
// 2. BANCOS DE DADOS (MEMÓRIA)
// ==========================================
const db = {
    vips: new Map(),
    historicoIA: new Map(),
    statusDono: null,
    grupos: {
        antiLink: new Map(),
        antiFoto: new Set(),
        palavrasBanidas: new Map(),
        banidos: new Map(),
        boasvindas: new Map()
    }
};

const NIVEIS_VIP = {
    bronze:   { nome: 'Bronze 🥉',   admin: false, ban: false },
    prata:    { nome: 'Prata 🥈',    admin: false, ban: false },
    ouro:     { nome: 'Ouro 🥇',     admin: true,  ban: true  },
    diamante: { nome: 'Diamante 💎', admin: true,  ban: true  },
    lenda:    { nome: 'Lenda 👑',    admin: true,  ban: true  }
};

// Servidor HTTP para health check
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<h1>💜 ${CONFIG.botName}</h1><p>Criado por ${CONFIG.creator}</p><p>🟢 Online</p>`);
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🌐 Servidor HTTP na porta ${PORT}`));

// ==========================================
// 3. FUNÇÕES AUXILIARES
// ==========================================
const utils = {
    isOwner: (id) => id.split('@')[0] === CONFIG.ownerId,
    
    getVip: (id) => {
        try {
            const vip = db.vips.get(id);
            if (vip && vip.expiraEm < Date.now()) {
                db.vips.delete(id);
                return null;
            }
            return vip;
        } catch (e) { return null; }
    },

    hasAdminRights: (id) => {
        try { return utils.isOwner(id) || (utils.getVip(id) && NIVEIS_VIP[utils.getVip(id).nivel].admin); } catch (e) { return false; }
    },
    hasBanRights: (id) => {
        try { return utils.isOwner(id) || (utils.getVip(id) && NIVEIS_VIP[utils.getVip(id).nivel].ban); } catch (e) { return false; }
    },

    tempoRestante: (id) => {
        try {
            const vip = db.vips.get(id);
            if (!vip) return null;
            const restante = vip.expiraEm - Date.now();
            if (restante <= 0) { db.vips.delete(id); return 'Expirado ❌'; }
            const d = Math.floor(restante / 86400000);
            const h = Math.floor((restante % 86400000) / 3600000);
            return `${d}d ${h}h`;
        } catch (e) { return 'Erro'; }
    },

    formatMenu: (titulo, comandos) => {
        return `╭┈⊰ 💜 『 *${CONFIG.botName}* 』\n┊\n╭┈❁ *${titulo}*\n┊\n${comandos.map(c => `┊💜 ${c}`).join('\n')}\n┊\n╰─┈┈┈┈┈◜❁◞┈┈┈┈┈─╯\n\n✨ *Criado por ${CONFIG.creator}* ✨`;
    },

    extractText: (msg) => {
        try {
            return msg.message?.conversation || 
                   msg.message?.extendedTextMessage?.text || 
                   msg.message?.imageMessage?.caption || 
                   msg.message?.videoMessage?.caption || 
                   msg.message?.documentMessage?.caption ||
                   "";
        } catch (e) { return ""; }
    },

    getQuotedMention: (msg) => {
        try { return msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]; } catch (e) { return null; }
    }
};
// ==========================================
// 4. INTELIGÊNCIA ARTIFICIAL (GROQ)
// ==========================================
async function askGroq(chatId, userText, contexto = '') {
    if (!db.historicoIA.has(chatId)) db.historicoIA.set(chatId, []);
    const history = db.historicoIA.get(chatId);
    
    history.push({ role: "user", content: userText });
    if (history.length > 10) history.shift();

    try {
        let systemMsg = `És o ${CONFIG.botName}, assistente virtual criado pelo ${CONFIG.creator}. Responde de forma natural, direta e com poucos emojis.

REGRAS OBRIGATÓRIAS:
1. NUNCA respondas perguntas sobre escola, trabalhos de casa (TPCs), matemática, física, química, biologia ou qualquer assunto científico/acadêmico. Se alguém perguntar, responde educadamente que não podes ajudar com isso.
2. NÃO dês informações pessoais do criador.
3. Se perguntarem onde está o criador, usa o status definido.`;

        if (db.statusDono) systemMsg += ` Status do dono: "${db.statusDono}"`;
        if (contexto) systemMsg += `\n\nCONTEXTO: ${contexto}`;

        const completion = await groq.chat.completions.create({
            messages: [{ role: "system", content: systemMsg }, ...history],
            model: "llama-3.1-8b-instant",
            temperature: 0.8,
            max_tokens: 200
        });

        const resposta = completion.choices[0]?.message?.content || "Deu branco aqui, tenta de novo! 🤖";
        history.push({ role: "assistant", content: resposta });
        return resposta;
    } catch (error) {
        console.error("Erro na IA:", error.message);
        return "❌ Estou com dificuldades técnicas. Tenta mais tarde.";
    }
}

// ==========================================
// 5. SISTEMA DE COMANDOS (PARTE 1)
// ==========================================
const commands = {
    'menu': async (sock, ctx) => {
        try {
            const text = utils.formatMenu('MENU PRINCIPAL', [
                '!menuia', '!menuadm', '!menubn', '!menudono', '!menuvip', '!info'
            ]);
            await sock.sendMessage(ctx.chatId, { text });
        } catch (e) { console.error('Erro menu:', e.message); }
    },
    'menuia': async (sock, ctx) => commands['menu'](sock, ctx),

    'info': async (sock, ctx) => {
        try {
            await sock.sendMessage(ctx.chatId, { 
                text: `╭┈⊰ 💜 『 *${CONFIG.botName}* 』\n┊\n┊🤖 *Bot:* ${CONFIG.botName}\n┊👤 *Dono:* ${CONFIG.creator}\n┊🆔 *ID do Dono:* ${CONFIG.ownerId}\n┊📱 *Nº do Dono:* ${CONFIG.ownerNumber}\n┊📱 *Nº do Bot:* ${CONFIG.botNumber.slice(3)}\n┊💜 *Status:* Online 24/7\n┊\n╰─┈┈┈┈┈◜❁◞┈┈┈┈┈─╯\n\n✨ *Criado por ${CONFIG.creator}* ✨`
            });
        } catch (e) { console.error('Erro info:', e.message); }
    },

    'menuadm': async (sock, ctx) => {
        try {
            const text = utils.formatMenu('GESTÃO DO GRUPO', [
                '!ban @pessoa', '!todos', '!fechargp', '!abrirgp',
                '!antilink [ban/kick/delete/off]', '!antifoto [on/off]',
                '!addpalavra [palavra]', '!delpalavra [palavra]',
                '!listapalavras', '!listaban'
            ]);
            await sock.sendMessage(ctx.chatId, { text });
        } catch (e) { console.error('Erro menuadm:', e.message); }
    },

    'menubn': async (sock, ctx) => {
        try {
            const text = utils.formatMenu('PUNIÇÕES RÁPIDAS', [
                '!ban @pessoa', '!todos', '!listaban'
            ]);
            await sock.sendMessage(ctx.chatId, { text });
        } catch (e) { console.error('Erro menubn:', e.message); }
    },

    'menudono': async (sock, ctx) => {
        if (!utils.isOwner(ctx.senderId)) return;
        try {
            const text = utils.formatMenu('COMANDOS DO DONO', [
                '!status [texto]', '!status ver', '!status reset',
                '!addvip @pessoa [nivel] [dias]', '!addvipid [ID] [nivel] [dias]',
                '!removevip @pessoa', '!listavip',
                '!boasvindas [texto]  (use @nome e @grupo)', '!boasvindas off'
            ]);
            await sock.sendMessage(ctx.chatId, { text });
        } catch (e) { console.error('Erro menudono:', e.message); }
    },

    'id': async (sock, ctx) => {
        try {
            const remetente = ctx.senderId;
            const idLimpo = remetente.split('@')[0];
            const numero = idLimpo.startsWith('258') ? idLimpo.slice(3) : idLimpo;
            const texto = `🆔 *TEU ID COMPLETO*\n\n📱 *Número:* ${numero}\n🔢 *ID:* ${remetente}\n\n📝 *VIP é pago!* Fale com ${CONFIG.creator}.`;
            await sock.sendMessage(ctx.chatId, { text: texto });
        } catch (e) { console.error('Erro id:', e.message); }
    },

    // ============ VIP ============
    'addvip': async (sock, ctx) => {
        if (!utils.isOwner(ctx.senderId)) return sock.sendMessage(ctx.chatId, { text: "❌ Só o meu criador pode dar VIP!" });
        try {
            const target = utils.getQuotedMention(ctx.msg);
            const nivel = ctx.args[0]?.toLowerCase() || 'bronze';
            const dias = parseInt(ctx.args[1]) || 30;

            if (!target || !NIVEIS_VIP[nivel]) 
                return sock.sendMessage(ctx.chatId, { text: "📝 Uso: !addvip @pessoa [nivel] [dias]\nEx: !addvip @joao ouro 30" });
            
            db.vips.set(target, { nivel, expiraEm: Date.now() + (dias * 86400000), diasTotal: dias });
            const nome = target.split('@')[0];
            const resposta = await askGroq(ctx.chatId, `!addvip @${nome}`, 
                `Acabaste de dar VIP ${NIVEIS_VIP[nivel].nome} para @${nome} por ${dias} dias. Dá uma mensagem de boas-vindas destacando que é um benefício pago.`);
            await sock.sendMessage(ctx.chatId, { text: resposta, mentions: [target] });
        } catch (e) { console.error('Erro addvip:', e.message); }
    },

    'addvipid': async (sock, ctx) => {
        if (!utils.isOwner(ctx.senderId)) return sock.sendMessage(ctx.chatId, { text: "❌ Só o meu criador pode dar VIP!" });
        try {
            const targetId = ctx.args[0];
            const nivel = ctx.args[1]?.toLowerCase() || 'bronze';
            const dias = parseInt(ctx.args[2]) || 30;

            if (!targetId || !NIVEIS_VIP[nivel]) 
                return sock.sendMessage(ctx.chatId, { text: "📝 Uso: !addvipid [ID] [nivel] [dias]\nEx: !addvipid 123456789 ouro 30" });

            const targetJid = targetId + '@s.whatsapp.net';
            db.vips.set(targetJid, { nivel, expiraEm: Date.now() + (dias * 86400000), diasTotal: dias });
            const resposta = await askGroq(ctx.chatId, `!addvipid ${targetId}`, 
                `Acabaste de dar VIP ${NIVEIS_VIP[nivel].nome} para o ID ${targetId} por ${dias} dias. Confirma com estilo.`);
            await sock.sendMessage(ctx.chatId, { text: resposta });
        } catch (e) { console.error('Erro addvipid:', e.message); }
    },

    'removevip': async (sock, ctx) => {
        if (!utils.isOwner(ctx.senderId)) return;
        try {
            const target = utils.getQuotedMention(ctx.msg);
            if (!target) return sock.sendMessage(ctx.chatId, { text: "❌ Marca quem queres remover!" });
            db.vips.delete(target);
            const resposta = await askGroq(ctx.chatId, '!removevip', `Removeste @${target.split('@')[0]} do VIP. Confirma de forma neutra.`);
            await sock.sendMessage(ctx.chatId, { text: resposta, mentions: [target] });
        } catch (e) { console.error('Erro removevip:', e.message); }
    },

    'listavip': async (sock, ctx) => {
        try {
            if (db.vips.size === 0) return sock.sendMessage(ctx.chatId, { text: "📝 Nenhum VIP cadastrado!\n\n💡 Lembre-se: VIP é pago. Fale com o dono." });
            let lista = "💜 *LISTA DE VIPs ATIVOS*\n\n";
            for (const [id, vip] of db.vips) {
                const nomeNivel = NIVEIS_VIP[vip.nivel].nome;
                const restante = utils.tempoRestante(id);
                lista += `👤 @${id.split('@')[0]}\n   ⭐ ${nomeNivel}\n   ⏰ ${restante}\n   🛡️ Admin: ${NIVEIS_VIP[vip.nivel].admin ? '✅' : '❌'}\n   🔨 Ban: ${NIVEIS_VIP[vip.nivel].ban ? '✅' : '❌'}\n──────────────\n`;
            }
            lista += `\n💲 *Todos os VIPs são pagos.* Para adquirir, fale com ${CONFIG.creator}.`;
            await sock.sendMessage(ctx.chatId, { text: lista, mentions: Array.from(db.vips.keys()) });
        } catch (e) { console.error('Erro listavip:', e.message); }
    },

    'menuvip': async (sock, ctx) => {
        try {
            const vip = utils.getVip(ctx.senderId);
            if (!vip && !utils.isOwner(ctx.senderId)) {
                return sock.sendMessage(ctx.chatId, { 
                    text: `💜 *SISTEMA VIP – NANO BOT*\n\n` +
                          `🌟 *Níveis Disponíveis:*\n` +
                          `🥉 Bronze\n🥈 Prata\n🥇 Ouro\n💎 Diamante\n👑 Lenda\n\n` +
                          `💲 *Todos os planos são PAGOS!*\n` +
                          `📝 Para adquirir, entre em contato com o Dono:\n` +
                          `👤 ${CONFIG.creator}\n📱 Nº ${CONFIG.ownerNumber}\n\n` +
                          `✨ *Comando para o Dono adicionar:* \`!addvip @pessoa nivel dias\`\n` +
                          `✨ *Ou via ID:* \`!addvipid [ID] nivel dias\``
                });
            }
            const n = vip ? NIVEIS_VIP[vip.nivel] : { nome: 'Dono Supremo 👑' };
            const r = vip ? utils.tempoRestante(ctx.senderId) : '∞ Eterno';
            const d = vip ? vip.diasTotal : '∞';
            await sock.sendMessage(ctx.chatId, { 
                text: `💜 *SEU STATUS VIP*\n\n` +
                      `⭐ *Nível:* ${n.nome}\n` +
                      `📅 *Dias Contratados:* ${d}\n` +
                      `⏰ *Tempo Restante:* ${r}\n\n` +
                      `🛡️ *Permissões:*\n` +
                      `👮 Administrar Grupo: ${vip ? (n.admin ? '✅ Sim' : '❌ Não') : '✅ Sim'}\n` +
                      `🔨 Banir Membros: ${vip ? (n.ban ? '✅ Sim' : '❌ Não') : '✅ Sim'}\n\n` +
                      `💲 *VIP PAGO – Obrigado por apoiar!*`
            });
        } catch (e) { console.error('Erro menuvip:', e.message); }
    },

    'status': async (sock, ctx) => {
        if (!utils.isOwner(ctx.senderId)) return;
        try {
            const sub = ctx.args.join(' ');
            
            if (!sub || sub === 'ver') {
                const resposta = await askGroq(ctx.chatId, '!status ver', `O status atual é "${db.statusDono || 'Online'}". Mostra isso de forma bonita.`);
                return sock.sendMessage(ctx.chatId, { text: resposta });
            }
            if (sub === 'reset') {
                db.statusDono = null;
                const resposta = await askGroq(ctx.chatId, '!status reset', 'Status resetado para o padrão. Confirma.');
                return sock.sendMessage(ctx.chatId, { text: resposta });
            }
            db.statusDono = sub;
            const resposta = await askGroq(ctx.chatId, `!status ${sub}`, `Status mudou para "${sub}". Confirma com estilo.`);
            await sock.sendMessage(ctx.chatId, { text: resposta });
        } catch (e) { console.error('Erro status:', e.message); }
    },    // ============ BOAS-VINDAS ============
    'boasvindas': async (sock, ctx) => {
        if (!ctx.isGroup) return sock.sendMessage(ctx.chatId, { text: "❌ Só funciona em grupos!" });
        if (!utils.isOwner(ctx.senderId)) return sock.sendMessage(ctx.chatId, { text: "❌ Só o dono pode configurar as boas-vindas!" });
        try {
            const textoCompleto = ctx.args.join(' ');
            if (!textoCompleto) {
                return sock.sendMessage(ctx.chatId, { text: "📝 Use: `!boasvindas [mensagem]`\nUse @nome para o nome do membro e @grupo para o nome do grupo.\nEx: `!boasvindas Bem-vindo, @nome, ao grupo @grupo!`\nPara desativar: `!boasvindas off`" });
            }
            if (textoCompleto.toLowerCase() === 'off') {
                db.grupos.boasvindas.delete(ctx.chatId);
                return sock.sendMessage(ctx.chatId, { text: "🔕 Boas-vindas desativadas neste grupo." });
            }
            db.grupos.boasvindas.set(ctx.chatId, textoCompleto);
            await sock.sendMessage(ctx.chatId, { text: "✅ Mensagem de boas-vindas configurada!\nPré-visualização: " + textoCompleto.replace('@nome', 'João').replace('@grupo', 'Amigos') });
        } catch (e) { console.error('Erro boasvindas:', e.message); }
    },

    // ============ ADMINISTRAÇÃO DE GRUPO ============
    'ban': async (sock, ctx) => {
        if (!ctx.isGroup) return sock.sendMessage(ctx.chatId, { text: "❌ Só funciona em grupos!" });
        if (!utils.hasBanRights(ctx.senderId)) return sock.sendMessage(ctx.chatId, { text: "❌ Não tens permissão VIP/Dono para banir." });
        try {
            const target = utils.getQuotedMention(ctx.msg);
            if (!target) return sock.sendMessage(ctx.chatId, { text: "❌ Marca quem queres banir!" });

            await sock.groupParticipantsUpdate(ctx.chatId, [target], 'remove');
            if (!db.grupos.banidos.has(ctx.chatId)) db.grupos.banidos.set(ctx.chatId, []);
            db.grupos.banidos.get(ctx.chatId).push({ id: target, data: new Date().toLocaleDateString('pt-BR') });
            
            const resposta = await askGroq(ctx.chatId, `!ban @${target.split('@')[0]}`, 
                `Baniste @${target.split('@')[0]} do grupo. Dá uma resposta engraçada ou séria.`);
            await sock.sendMessage(ctx.chatId, { text: resposta, mentions: [target] });
        } catch (e) {
            console.error('Erro ban:', e.message);
            await sock.sendMessage(ctx.chatId, { text: "❌ O bot precisa de ser Administrador do grupo!" });
        }
    },

    'todos': async (sock, ctx) => {
        if (!ctx.isGroup || !utils.hasAdminRights(ctx.senderId)) return;
        try {
            const meta = await sock.groupMetadata(ctx.chatId);
            await sock.sendMessage(ctx.chatId, { text: "📢 *ATENÇÃO TODOS!*", mentions: meta.participants.map(p => p.id) });
            const resposta = await askGroq(ctx.chatId, '!todos', 'Marcaste todos no grupo. Dá uma mensagem engraçada chamando atenção.');
            await sock.sendMessage(ctx.chatId, { text: resposta });
        } catch (e) { console.error('Erro todos:', e.message); }
    },

    'fechargp': async (sock, ctx) => {
        if (!ctx.isGroup || !utils.hasAdminRights(ctx.senderId)) return;
        try {
            await sock.groupSettingUpdate(ctx.chatId, 'announcement');
            const resposta = await askGroq(ctx.chatId, '!fechargp', 'Fechaste o grupo. Explica que só admins podem falar agora.');
            await sock.sendMessage(ctx.chatId, { text: resposta });
        } catch (e) { console.error('Erro fechargp:', e.message); }
    },

    'abrirgp': async (sock, ctx) => {
        if (!ctx.isGroup || !utils.hasAdminRights(ctx.senderId)) return;
        try {
            await sock.groupSettingUpdate(ctx.chatId, 'not_announcement');
            const resposta = await askGroq(ctx.chatId, '!abrirgp', 'Abriste o grupo. Comemora que todos podem falar novamente.');
            await sock.sendMessage(ctx.chatId, { text: resposta });
        } catch (e) { console.error('Erro abrirgp:', e.message); }
    },

    // ============ AUTO-MODERAÇÃO ============
    'antilink': async (sock, ctx) => {
        if (!ctx.isGroup || !utils.hasAdminRights(ctx.senderId)) return;
        try {
            const mode = ctx.args[0];
            if (!mode || !['ban', 'kick', 'delete', 'warn', 'off'].includes(mode)) {
                return sock.sendMessage(ctx.chatId, { text: "📝 Modos: ban, kick, delete, warn, off\nEx: !antilink ban" });
            }
            if (mode === 'off') {
                db.grupos.antiLink.delete(ctx.chatId);
                const resposta = await askGroq(ctx.chatId, '!antilink off', 'Desativaste o anti‑link. Informa o grupo.');
                return sock.sendMessage(ctx.chatId, { text: resposta });
            }
            db.grupos.antiLink.set(ctx.chatId, mode);
            const resposta = await askGroq(ctx.chatId, `!antilink ${mode}`, `Ativaste anti‑link no modo ${mode}. Confirma.`);
            await sock.sendMessage(ctx.chatId, { text: resposta });
        } catch (e) { console.error('Erro antilink:', e.message); }
    },

    'antifoto': async (sock, ctx) => {
        if (!ctx.isGroup || !utils.hasAdminRights(ctx.senderId)) return;
        try {
            const acao = ctx.args[0];
            if (acao === 'on' || acao === 'ativar') {
                db.grupos.antiFoto.add(ctx.chatId);
                const resposta = await askGroq(ctx.chatId, '!antifoto on', 'Ativaste bloqueio de fotos. Avisa de forma engraçada.');
                await sock.sendMessage(ctx.chatId, { text: resposta });
            } else if (acao === 'off' || acao === 'desativar') {
                db.grupos.antiFoto.delete(ctx.chatId);
                const resposta = await askGroq(ctx.chatId, '!antifoto off', 'Desativaste bloqueio de fotos. Comemora.');
                await sock.sendMessage(ctx.chatId, { text: resposta });
            } else {
                await sock.sendMessage(ctx.chatId, { text: "📝 Uso: !antifoto on/off" });
            }
        } catch (e) { console.error('Erro antifoto:', e.message); }
    },

    'addpalavra': async (sock, ctx) => {
        if (!ctx.isGroup || !utils.hasAdminRights(ctx.senderId)) return;
        try {
            const palavra = ctx.args.join(' ').toLowerCase().trim();
            if (!palavra) return sock.sendMessage(ctx.chatId, { text: "❌ Digita a palavra!" });
            if (!db.grupos.palavrasBanidas.has(ctx.chatId)) db.grupos.palavrasBanidas.set(ctx.chatId, []);
            const lista = db.grupos.palavrasBanidas.get(ctx.chatId);
            if (lista.includes(palavra)) return sock.sendMessage(ctx.chatId, { text: `⚠️ "${palavra}" já está na lista!` });
            lista.push(palavra);
            const resposta = await askGroq(ctx.chatId, `!addpalavra ${palavra}`, `Proibiste a palavra "${palavra}". Avisa o grupo.`);
            await sock.sendMessage(ctx.chatId, { text: resposta });
        } catch (e) { console.error('Erro addpalavra:', e.message); }
    },

    'delpalavra': async (sock, ctx) => {
        if (!ctx.isGroup || !utils.hasAdminRights(ctx.senderId)) return;
        try {
            const palavra = ctx.args.join(' ').toLowerCase().trim();
            if (!palavra) return sock.sendMessage(ctx.chatId, { text: "❌ Digita a palavra!" });
            if (!db.grupos.palavrasBanidas.has(ctx.chatId)) return sock.sendMessage(ctx.chatId, { text: "📝 Nenhuma palavra banida!" });
            const lista = db.grupos.palavrasBanidas.get(ctx.chatId);
            const idx = lista.indexOf(palavra);
            if (idx === -1) return sock.sendMessage(ctx.chatId, { text: `⚠️ "${palavra}" não encontrada!` });
            lista.splice(idx, 1);
            await sock.sendMessage(ctx.chatId, { text: `✅ Palavra "${palavra}" removida da lista!` });
        } catch (e) { console.error('Erro delpalavra:', e.message); }
    },

    'listapalavras': async (sock, ctx) => {
        if (!ctx.isGroup) return;
        try {
            const lista = db.grupos.palavrasBanidas.get(ctx.chatId) || [];
            if (lista.length === 0) return sock.sendMessage(ctx.chatId, { text: "📝 Nenhuma palavra banida neste grupo!" });
            await sock.sendMessage(ctx.chatId, { text: `🚫 *PALAVRAS BANIDAS*\n\n${lista.map((p, i) => `${i+1}. ${p}`).join('\n')}` });
        } catch (e) { console.error('Erro listapalavras:', e.message); }
    },

    'listaban': async (sock, ctx) => {
        if (!ctx.isGroup) return;
        try {
            const lista = db.grupos.banidos.get(ctx.chatId) || [];
            if (lista.length === 0) return sock.sendMessage(ctx.chatId, { text: "📝 Nenhum banido neste grupo!" });
            let txt = "🚫 *BANIDOS DO GRUPO*\n\n";
            lista.forEach(b => { txt += `👤 @${b.id.split('@')[0]} - ${b.data}\n`; });
            await sock.sendMessage(ctx.chatId, { text: txt, mentions: lista.map(b => b.id) });
        } catch (e) { console.error('Erro listaban:', e.message); }
    },

    // ============ IA DIRETA ============
    'ia': async (sock, ctx) => {
        try {
            const question = ctx.args.join(' ');
            if (!question) return sock.sendMessage(ctx.chatId, { text: "❓ O que queres perguntar à IA?" });
            await sock.sendPresenceUpdate('composing', ctx.chatId);
            const resposta = await askGroq(ctx.chatId, question);
            await sock.sendMessage(ctx.chatId, { text: resposta }, { quoted: ctx.msg });
        } catch (e) { console.error('Erro ia:', e.message); }
    },
    'ask': async (sock, ctx) => commands['ia'](sock, ctx),
};// ==========================================
// 6. MOTOR DO BOT (BAILEYS)
// ==========================================
async function startBot() {
    let sock;
    try {
        const { state, saveCreds } = await useMultiFileAuthState('sessao_nano');
        const { version } = await fetchLatestBaileysVersion();

        sock = makeWASocket({
            version,
            auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' })) },
            printQRInTerminal: false,
            browser: ['Ubuntu', 'Chrome', '20.0.04'],
            logger: pino({ level: 'fatal' }),
            syncFullHistory: false,
            markOnlineOnConnect: true
        });

        if (!sock.authState.creds.registered) {
            setTimeout(async () => {
                try {
                    let code = await sock.requestPairingCode(CONFIG.botNumber);
                    code = code?.match(/.{1,4}/g)?.join('-') || code;
                    console.log(`\n=== CÓDIGO DE PAREAMENTO ===\n${code}\n===========================\n`);
                } catch (error) {
                    console.log('❌ Erro ao gerar código:', error.message);
                }
            }, 5000);
        }

        sock.ev.on('creds.update', saveCreds);

        // Boas-vindas
        sock.ev.on('group-participants.update', async (event) => {
            try {
                const { id: groupId, participants, action } = event;
                if (action === 'add' && db.grupos.boasvindas.has(groupId)) {
                    const mensagemBoasVindas = db.grupos.boasvindas.get(groupId);
                    const metadata = await sock.groupMetadata(groupId);
                    const groupName = metadata.subject;
                    for (const participant of participants) {
                        const nome = `@${participant.split('@')[0]}`;
                        const textoFinal = mensagemBoasVindas
                            .replace(/@nome/g, nome)
                            .replace(/@grupo/g, groupName);
                        await sock.sendMessage(groupId, { text: textoFinal, mentions: [participant] });
                    }
                }
            } catch (e) { console.error('Erro boas-vindas:', e.message); }
        });

        // Processamento de mensagens
        sock.ev.on('messages.upsert', async ({ messages }) => {
            try {
                const msg = messages[0];
                if (!msg.message || msg.key.fromMe) return;

                const chatId = msg.key.remoteJid;
                const isGroup = chatId.endsWith('@g.us');
                const senderId = isGroup ? msg.key.participant : chatId;
                const fullText = utils.extractText(msg);
                
                console.log(`[MSG] ${isGroup ? 'Grupo' : 'Privado'} | ${senderId.split('@')[0]}: "${fullText.substring(0, 50)}${fullText.length > 50 ? '...' : ''}"`);

                if (!fullText) return;

                // Auto-moderação
                if (isGroup && !utils.hasAdminRights(senderId)) {
                    const antiLinkMode = db.grupos.antiLink.get(chatId);
                    if (antiLinkMode && antiLinkMode !== 'off' && /https?:\/\//i.test(fullText)) {
                        await sock.sendMessage(chatId, { delete: msg.key });
                        if (antiLinkMode === 'ban' || antiLinkMode === 'kick') {
                            try { await sock.groupParticipantsUpdate(chatId, [senderId], 'remove'); } catch(e) {}
                        }
                        return sock.sendMessage(chatId, { text: `⚠️ Link apagado! @${senderId.split('@')[0]}`, mentions: [senderId] });
                    }
                    if (db.grupos.antiFoto.has(chatId) && (msg.message.imageMessage || msg.message.videoMessage)) {
                        await sock.sendMessage(chatId, { delete: msg.key });
                        return sock.sendMessage(chatId, { text: `📸❌ Mídia apagada! @${senderId.split('@')[0]}`, mentions: [senderId] });
                    }
                    const badWords = db.grupos.palavrasBanidas.get(chatId) || [];
                    const found = badWords.find(word => fullText.toLowerCase().includes(word));
                    if (found) {
                        await sock.sendMessage(chatId, { delete: msg.key });
                        return sock.sendMessage(chatId, { text: `🚫 Palavra "${found}" proibida! @${senderId.split('@')[0]}`, mentions: [senderId] });
                    }
                }

                // Comandos
                if (fullText.startsWith(CONFIG.prefix)) {
                    const args = fullText.slice(CONFIG.prefix.length).trim().split(/ +/);
                    const commandName = args.shift().toLowerCase();
                    if (commands[commandName]) {
                        const ctx = { chatId, senderId, isGroup, msg, args };
                        await commands[commandName](sock, ctx);
                    }
                    return;
                }

                // IA conversacional
                if (!isGroup) {
                    await sock.sendPresenceUpdate('composing', chatId);
                    const resposta = await askGroq(chatId, fullText);
                    await sock.sendMessage(chatId, { text: resposta }, { quoted: msg });
                } else if (fullText.toLowerCase().includes('nano') || fullText.toLowerCase().includes('bot')) {
                    await sock.sendPresenceUpdate('composing', chatId);
                    const resposta = await askGroq(chatId, fullText);
                    await sock.sendMessage(chatId, { text: resposta }, { quoted: msg });
                }
            } catch (e) { console.error('Erro no processamento:', e.message); }
        });

        // Reconexão robusta
        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                console.log(`🔌 Conexão fechada (código ${statusCode}).`);
                // Sempre tenta reconectar, exceto se loggedOut
                if (statusCode !== DisconnectReason.loggedOut) {
                    console.log('🔄 Tentando reconectar em 5 segundos...');
                    setTimeout(() => startBot(), 5000);
                } else {
                    console.log('⚠️ Sessão expirada. Apague a pasta sessao_nano e reinicie.');
                }
            } else if (connection === 'open') {
                console.log('✅ NANO BOT CONECTADO!');
                try {
                    sock.sendMessage(`${CONFIG.ownerId}@s.whatsapp.net`, { text: `✅ Nano Bot online! Manda !menu para começar.` });
                } catch (e) { /* silencioso */ }
            }
        });

    } catch (err) {
        console.error('Erro fatal ao iniciar:', err.message);
        console.log('🔄 Reiniciando em 10 segundos...');
        setTimeout(() => startBot(), 10000);
    }
}

// ========= INICIAR ==========
startBot().catch(console.error);
