
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const VERSION = "Experimental-7.3";
const DIFFICULTY = 4;
const BLOCK_REWARD = 1;
const MINING_ADDRESS = "RAVA_MINING_REWARD";
const DATA_FILE =
  process.env.RAVA_DATA_FILE ||
  path.join(__dirname, "rava-data.json");

const UNIT = 100000000;

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(JSON.stringify(data, null, 2));
}

function validAddress(address) {
  return typeof address === "string" &&
    /^[a-f0-9]{40}$/.test(address);
}

function validAmount(amount) {
  if (typeof amount !== "number" ||
      !Number.isFinite(amount) ||
      amount <= 0) {
    return false;
  }

  const scaled = amount * UNIT;
  return Number.isSafeInteger(Math.round(scaled)) &&
    Math.abs(scaled - Math.round(scaled)) < 0.00001;
}

function units(amount) {
  return Math.round(amount * UNIT);
}

function coins(value) {
  return Number((value / UNIT).toFixed(8));
}

function addressFromPublicKey(publicKey) {
  return crypto.createHash("sha256")
    .update(publicKey)
    .digest("hex")
    .slice(0, 40);
}

function transactionData(tx) {
  return JSON.stringify({
    from: tx.from,
    to: tx.to,
    amount: tx.amount
  });
}

function rawEcdsaToDer(raw) {
  if (raw.length !== 64) {
    throw new Error("Tamanho de assinatura inválido.");
  }

  function encodeInteger(bytes) {
    let i = 0;
    while (i < bytes.length - 1 && bytes[i] === 0) i++;

    let value = Buffer.from(bytes.subarray(i));

    if (value[0] & 0x80) {
      value = Buffer.concat([Buffer.from([0]), value]);
    }

    return Buffer.concat([
      Buffer.from([0x02, value.length]),
      value
    ]);
  }

  const r = encodeInteger(raw.subarray(0, 32));
  const s = encodeInteger(raw.subarray(32, 64));
  const body = Buffer.concat([r, s]);

  return Buffer.concat([
    Buffer.from([0x30, body.length]),
    body
  ]);
}

function verifyTransaction(tx) {
  try {
    if (!tx || tx.from === MINING_ADDRESS) return false;
    if (!validAddress(tx.from) || !validAddress(tx.to)) return false;
    if (tx.from === tx.to) return false;
    if (!validAmount(tx.amount)) return false;
    if (typeof tx.publicKey !== "string") return false;
    if (typeof tx.signature !== "string") return false;
    if (!/^[a-f0-9]{128}$/i.test(tx.signature)) return false;
    if (addressFromPublicKey(tx.publicKey) !== tx.from) return false;

    const der = rawEcdsaToDer(Buffer.from(tx.signature, "hex"));
    const verifier = crypto.createVerify("SHA256");
    verifier.update(transactionData(tx), "utf8");
    verifier.end();

    return verifier.verify(tx.publicKey, der);
  } catch {
    return false;
  }
}

class Block {
  constructor(index, transactions, previousHash) {
    this.index = index;
    this.timestamp = new Date().toISOString();
    this.transactions = transactions;
    this.previousHash = previousHash;
    this.nonce = 0;
    this.hash = this.calculateHash();
  }

  calculateHash() {
    return crypto.createHash("sha256")
      .update(JSON.stringify({
        index: this.index,
        timestamp: this.timestamp,
        transactions: this.transactions,
        previousHash: this.previousHash,
        nonce: this.nonce
      }))
      .digest("hex");
  }

  mine(difficulty) {
    const target = "0".repeat(difficulty);

    while (!this.hash.startsWith(target)) {
      this.nonce++;
      this.hash = this.calculateHash();
    }
  }
}

class Blockchain {
  constructor() {
    this.chain = [new Block(0, [], "0")];
    this.pendingTransactions = [];
    this.reward = BLOCK_REWARD;
    this.difficulty = DIFFICULTY;
  }

  get lastBlock() {
    return this.chain[this.chain.length - 1];
  }

  getConfirmedUnits(address) {
    let balance = 0;

    for (const block of this.chain) {
      for (const tx of block.transactions) {
        if (tx.to === address) balance += units(tx.amount);
        if (tx.from === address) balance -= units(tx.amount);
      }
    }

    return balance;
  }

  getConfirmedBalance(address) {
    return coins(this.getConfirmedUnits(address));
  }

  getAvailableBalance(address) {
    let balance = this.getConfirmedUnits(address);

    for (const tx of this.pendingTransactions) {
      if (tx.from === address) balance -= units(tx.amount);
    }

    return coins(balance);
  }

  getTotalSupply() {
    let supply = 0;

    for (const block of this.chain) {
      for (const tx of block.transactions) {
        if (tx.from === MINING_ADDRESS) supply += units(tx.amount);
      }
    }

    return coins(supply);
  }

  addTransaction(tx) {
    if (!verifyTransaction(tx)) {
      throw new Error("Assinatura ou dados inválidos.");
    }

    if (this.getAvailableBalance(tx.from) < tx.amount) {
      throw new Error("Saldo disponível insuficiente.");
    }

    const pending = {
      from: tx.from,
      to: tx.to,
      amount: tx.amount,
      publicKey: tx.publicKey,
      signature: tx.signature
    };

    this.pendingTransactions.push(pending);
    saveState(this);

    return this.pendingTransactions.length;
  }

  minePendingTransactions(minerAddress) {
    if (!validAddress(minerAddress)) {
      throw new Error("Endereço de minerador inválido.");
    }

    const balances = new Map();
    const balanceOf = address => {
      if (!balances.has(address)) {
        balances.set(address, this.getConfirmedUnits(address));
      }
      return balances.get(address);
    };

    const included = [];

    for (const tx of this.pendingTransactions) {
      if (!verifyTransaction(tx)) continue;
      if (balanceOf(tx.from) < units(tx.amount)) continue;

      balances.set(tx.from, balanceOf(tx.from) - units(tx.amount));
      balances.set(tx.to, balanceOf(tx.to) + units(tx.amount));
      included.push(tx);
    }

    const rewardTransaction = {
      from: MINING_ADDRESS,
      to: minerAddress,
      amount: this.reward
    };

    const block = new Block(
      this.chain.length,
      [...included, rewardTransaction],
      this.lastBlock.hash
    );

    block.mine(this.difficulty);
    this.chain.push(block);
    this.pendingTransactions = [];

    if (!this.isValid()) {
      this.chain.pop();
      throw new Error("Bloco rejeitado pela validação da blockchain.");
    }

    saveState(this);

    return {
      block,
      transacoesIncluidas: included.length
    };
  }

  isValid() {
    if (!Array.isArray(this.chain) || this.chain.length === 0) {
      return false;
    }

    const genesis = this.chain[0];

    if (
      genesis.index !== 0 ||
      genesis.previousHash !== "0" ||
      genesis.transactions.length !== 0 ||
      genesis.hash !== genesis.calculateHash()
    ) {
      return false;
    }

    const balances = new Map();

    const balanceOf = address => balances.get(address) || 0;

    const changeBalance = (address, amount) => {
      const next = balanceOf(address) + amount;
      if (!Number.isSafeInteger(next)) {
        throw new Error("Saldo fora do intervalo permitido.");
      }
      balances.set(address, next);
    };

    try {
      for (let i = 1; i < this.chain.length; i++) {
        const block = this.chain[i];
        const previous = this.chain[i - 1];

        if (block.index !== i) return false;
        if (block.hash !== block.calculateHash()) return false;
        if (block.previousHash !== previous.hash) return false;
        if (!block.hash.startsWith("0".repeat(this.difficulty))) {
          return false;
        }

        if (!Array.isArray(block.transactions) ||
            block.transactions.length === 0) {
          return false;
        }

        const rewards = block.transactions.filter(
          tx => tx.from === MINING_ADDRESS
        );

        if (rewards.length !== 1) return false;

        const rewardTx = block.transactions[block.transactions.length - 1];

        if (rewardTx.from !== MINING_ADDRESS ||
            rewardTx.amount !== this.reward ||
            !validAddress(rewardTx.to)) {
          return false;
        }

        for (let j = 0; j < block.transactions.length - 1; j++) {
          const tx = block.transactions[j];

          if (!verifyTransaction(tx)) return false;
          if (balanceOf(tx.from) < units(tx.amount)) return false;

          changeBalance(tx.from, -units(tx.amount));
          changeBalance(tx.to, units(tx.amount));
        }

        changeBalance(rewardTx.to, units(rewardTx.amount));
      }
    } catch {
      return false;
    }

    return true;
  }
}

function saveState(blockchain) {
  const data = {
    version: VERSION,
    chain: blockchain.chain,
    pendingTransactions: blockchain.pendingTransactions
  };

  const tempFile = DATA_FILE + ".tmp";
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(tempFile, JSON.stringify(data), { mode: 0o600 });
  fs.renameSync(tempFile, DATA_FILE);
}

function loadState() {
  if (!fs.existsSync(DATA_FILE)) {
    const fresh = new Blockchain();
    saveState(fresh);
    return fresh;
  }

  const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));

  if (!data || !Array.isArray(data.chain) ||
      !Array.isArray(data.pendingTransactions)) {
    throw new Error("Arquivo de dados RAVA inválido; não foi sobrescrito.");
  }

  const blockchain = new Blockchain();

  blockchain.chain = data.chain.map(raw => {
    const block = Object.create(Block.prototype);
    Object.assign(block, raw);
    return block;
  });

  blockchain.pendingTransactions = data.pendingTransactions;
  blockchain.reward = BLOCK_REWARD;
  blockchain.difficulty = DIFFICULTY;

  if (!blockchain.isValid()) {
    throw new Error("Blockchain salva inválida; dados preservados para análise.");
  }

  for (const tx of blockchain.pendingTransactions) {
    if (!verifyTransaction(tx)) {
      throw new Error("Transação pendente inválida no arquivo de dados.");
    }
  }

  return blockchain;
}

let rava = loadState();

const WALLET_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Carteira RAVA Experimental-7.3</title>
<style>
body{font-family:Arial,sans-serif;max-width:760px;margin:30px auto;padding:0 16px;background:#10151d;color:#f1f5f9}
.card{background:#1b2430;padding:18px;border-radius:12px;margin:16px 0}
input,textarea,button{box-sizing:border-box;width:100%;padding:12px;margin:7px 0;border-radius:7px;border:1px solid #465365;font:inherit}
input,textarea{background:#10151d;color:#f1f5f9}
button{background:#8de0b1;color:#102018;font-weight:bold;cursor:pointer}
small,.notice{color:#ffd38a;overflow-wrap:anywhere}
pre{white-space:pre-wrap;overflow-wrap:anywhere}
</style>
</head>
<body>
<h1>RAVA Network</h1>
<p>Carteira experimental — versão 7.3</p>

<div class="card">
<h2>1. Criar ou recuperar carteira</h2>
<p>A chave privada é criada ou importada no navegador. Ela não é enviada ao servidor.</p>
<button id="create">Gerar carteira nova</button>
<label>Importar arquivo de carteira JSON</label>
<input id="walletFile" type="file" accept=".json,application/json">
<button id="import">Importar carteira selecionada</button>
<button id="export">Exportar carteira para arquivo JSON</button>
<p>Endereço</p><textarea id="address" rows="2" readonly></textarea>
<p>Chave pública</p><textarea id="pub" rows="4" readonly></textarea>
<p>Chave privada — guarde com cuidado</p>
<textarea id="priv" rows="5" readonly></textarea>
<p class="notice">Nunca compartilhe a chave privada. Guarde o arquivo exportado em local seguro. Esta carteira é experimental.</p>
<pre id="walletResult"></pre>
</div>

<div class="card">
<h2>2. Saldo</h2>
<button id="balance">Consultar saldo</button>
<pre id="balanceResult"></pre>
</div>

<div class="card">
<h2>3. Enviar RVA</h2>
<label>Endereço de destino</label>
<input id="to" placeholder="Endereço público do destinatário">
<label>Valor (até 8 casas decimais)</label>
<input id="amount" type="number" min="0.00000001" step="0.00000001" placeholder="0.5">
<button id="send">Assinar e enviar</button>
<pre id="sendResult"></pre>
</div>

<script>
let wallet = null;
const el = id => document.getElementById(id);

function hex(bytes) {
  return Array.from(new Uint8Array(bytes))
    .map(b => b.toString(16).padStart(2, "0")).join("");
}

function pem(label, bytes) {
  let binary = "";
  for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b);
  const b64 = btoa(binary);
  const lines = b64.match(/.{1,64}/g).join("\\n");
  return "-----BEGIN " + label + "-----\\n" +
    lines + "\\n-----END " + label + "-----\\n";
}

function fromPem(text) {
  const base64 = text
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\\s/g, "");
  const binary = atob(base64);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

async function makeAddress(publicPem) {
  const digest = await crypto.subtle.digest(
    "SHA-256", new TextEncoder().encode(publicPem)
  );
  return hex(digest).slice(0, 40);
}

async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.erro || "Falha na requisição");
  return data;
}

function showWallet(address, publicKey, privateKey) {
  el("address").value = address;
  el("pub").value = publicKey;
  el("priv").value = privateKey;
}

async function importWalletObject(data) {
  if (!data || typeof data.publicKey !== "string" ||
      typeof data.privateKey !== "string") {
    throw new Error("Arquivo de carteira inválido.");
  }

  const publicBytes = fromPem(data.publicKey);
  const privateBytes = fromPem(data.privateKey);

  const publicKey = await crypto.subtle.importKey(
    "spki", publicBytes,
    {name:"ECDSA", namedCurve:"P-256"}, true, ["verify"]
  );

  const privateKey = await crypto.subtle.importKey(
    "pkcs8", privateBytes,
    {name:"ECDSA", namedCurve:"P-256"}, true, ["sign"]
  );

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const signature = await crypto.subtle.sign(
    {name:"ECDSA", hash:"SHA-256"}, privateKey, challenge
  );

  const matches = await crypto.subtle.verify(
    {name:"ECDSA", hash:"SHA-256"}, publicKey, signature, challenge
  );

  if (!matches) throw new Error("As chaves não correspondem.");

  const address = await makeAddress(data.publicKey);

  if (data.address && data.address !== address) {
    throw new Error("O endereço não corresponde à chave pública.");
  }

  wallet = { privateKey, publicKey };
  showWallet(address, data.publicKey, data.privateKey);
  el("walletResult").textContent = "Carteira importada e validada.";
}

el("create").onclick = async () => {
  try {
    wallet = await crypto.subtle.generateKey(
      {name:"ECDSA", namedCurve:"P-256"}, true, ["sign","verify"]
    );

    const pubBytes = await crypto.subtle.exportKey("spki", wallet.publicKey);
    const privBytes = await crypto.subtle.exportKey("pkcs8", wallet.privateKey);
    const publicKey = pem("PUBLIC KEY", pubBytes);
    const privateKey = pem("PRIVATE KEY", privBytes);
    const address = await makeAddress(publicKey);

    showWallet(address, publicKey, privateKey);
    el("walletResult").textContent =
      "Carteira criada. Exporte um arquivo de backup para recuperá-la depois.";
    el("balanceResult").textContent = "";
    el("sendResult").textContent = "";
  } catch (e) {
    el("walletResult").textContent = "Erro: " + e.message;
  }
};

el("export").onclick = () => {
  try {
    const address = el("address").value.trim();
    const publicKey = el("pub").value;
    const privateKey = el("priv").value;

    if (!wallet || !address || !publicKey || !privateKey) {
      throw new Error("Gere ou importe uma carteira primeiro.");
    }

    const data = JSON.stringify({
      version: "Experimental-7.3",
      address,
      publicKey,
      privateKey
    }, null, 2);

    const blob = new Blob([data], {type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "rava-wallet-backup.json";
    a.click();
    URL.revokeObjectURL(url);
    el("walletResult").textContent =
      "Backup exportado. Guarde-o em local seguro.";
  } catch (e) {
    el("walletResult").textContent = "Erro: " + e.message;
  }
};

el("import").onclick = async () => {
  try {
    const file = el("walletFile").files[0];
    if (!file) throw new Error("Selecione seu arquivo JSON de carteira.");

    const data = JSON.parse(await file.text());
    await importWalletObject(data);
  } catch (e) {
    el("walletResult").textContent = "Erro: " + e.message;
  }
};

el("balance").onclick = async () => {
  try {
    const address = el("address").value.trim();
    if (!address) throw new Error("Crie ou importe uma carteira primeiro.");
    const data = await request("/balance?address=" + encodeURIComponent(address));
    el("balanceResult").textContent = JSON.stringify(data, null, 2);
  } catch (e) {
    el("balanceResult").textContent = "Erro: " + e.message;
  }
};

el("send").onclick = async () => {
  try {
    if (!wallet) throw new Error("Gere ou importe a carteira antes de enviar.");

    const from = el("address").value.trim();
    const to = el("to").value.trim();
    const amount = Number(el("amount").value);

    if (!/^[a-f0-9]{40}$/.test(to)) {
      throw new Error("Endereço de destino inválido.");
    }

    if (!Number.isFinite(amount) || amount <= 0 ||
        Math.abs(amount * 100000000 -
          Math.round(amount * 100000000)) > 0.00001) {
      throw new Error("Informe um valor positivo com até 8 casas decimais.");
    }

    const tx = {from, to, amount};
    const bytes = new TextEncoder().encode(JSON.stringify(tx));
    const signature = await crypto.subtle.sign(
      {name:"ECDSA", hash:"SHA-256"}, wallet.privateKey, bytes
    );

    const data = await request("/transaction", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({
        ...tx,
        publicKey: el("pub").value,
        signature: hex(signature)
      })
    });

    el("sendResult").textContent = JSON.stringify(data, null, 2);
  } catch (e) {
    el("sendResult").textContent = "Erro: " + e.message;
  }
};
</script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    return res.end();
  }

  const url = new URL(req.url, "http://localhost");

  try {
    if (url.pathname === "/" && req.method === "GET") {
      return sendJson(res, 200, {
        projeto: "RAVA Network",
        versao: VERSION,
        status: "online",
        blocos: rava.chain.length,
        dificuldade: rava.difficulty,
        recompensaPorBloco: rava.reward,
        moedasEmCirculacao: rava.getTotalSupply(),
        transacoesPendentes: rava.pendingTransactions.length,
        armazenamento: DATA_FILE,
        aviso: "Projeto educacional. Persistência depende de disco durável no servidor."
      });
    }

    if (url.pathname === "/wallet" && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      });
      return res.end(WALLET_HTML);
    }

    if (url.pathname === "/balance" && req.method === "GET") {
      const address = url.searchParams.get("address");

      if (!validAddress(address)) {
        return sendJson(res, 400, {
          erro: "Informe ?address=SEU_ENDERECO válido."
        });
      }

      return sendJson(res, 200, {
        versao: VERSION,
        address,
        saldoConfirmado: rava.getConfirmedBalance(address),
        saldoDisponivel: rava.getAvailableBalance(address),
        moedasEmCirculacao: rava.getTotalSupply()
      });
    }

    if (url.pathname === "/transaction" && req.method === "POST") {
      let body = "";

      for await (const chunk of req) {
        body += chunk;
        if (body.length > 20000) {
          return sendJson(res, 413, {erro: "Requisição muito grande."});
        }
      }

      const input = JSON.parse(body || "{}");
      const {from, to, amount, publicKey, signature} = input;

      if (!validAddress(from) || !validAddress(to)) {
        return sendJson(res, 400, {erro: "Endereço inválido."});
      }

      if (!validAmount(amount)) {
        return sendJson(res, 400, {
          erro: "Valor inválido. Use um número positivo com até 8 casas decimais."
        });
      }

      const tx = {from, to, amount, publicKey, signature};
      const pendentes = rava.addTransaction(tx);

      return sendJson(res, 201, {
        versao: VERSION,
        acao: "transação assinada e adicionada à fila",
        transacao: tx,
        assinaturaValida: true,
        transacoesPendentes: pendentes
      });
    }

    if (url.pathname === "/transaction" && req.method === "GET") {
      return sendJson(res, 405, {
        erro: "Use a carteira em /wallet para assinar e enviar transações."
      });
    }

    if (url.pathname === "/mine" && req.method === "GET") {
      const minerAddress = url.searchParams.get("miner");

      if (!validAddress(minerAddress)) {
        return sendJson(res, 400, {
          erro: "Informe ?miner=SEU_ENDERECO válido."
        });
      }

      const result = rava.minePendingTransactions(minerAddress);

      return sendJson(res, 200, {
        versao: VERSION,
        acao: "bloco minerado",
        recompensa: rava.reward,
        transacoesIncluidas: result.transacoesIncluidas,
        bloco: result.block,
        saldoDoMinerador: rava.getConfirmedBalance(minerAddress),
        moedasEmCirculacao: rava.getTotalSupply()
      });
    }

    if (url.pathname === "/validate" && req.method === "GET") {
      return sendJson(res, 200, {
        versao: VERSION,
        blockchainValida: rava.isValid(),
        blocos: rava.chain.length
      });
    }

    if (url.pathname === "/chain" && req.method === "GET") {
      return sendJson(res, 200, {
        versao: VERSION,
        chain: rava.chain,
        transacoesPendentes: rava.pendingTransactions
      });
    }

    return sendJson(res, 404, {
      erro: "Rota não encontrada.",
      rotas: ["/", "/wallet", "/balance", "/transaction",
              "/mine", "/validate", "/chain"]
    });
  } catch (error) {
    return sendJson(res, 400, {
      erro: error.message || "Erro ao processar a requisição."
    });
  }
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(VERSION + " da RAVA Network rodando na porta " + PORT);
});
