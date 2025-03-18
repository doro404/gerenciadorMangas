const cors = require('cors');
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const sqlite3 = require('sqlite3').verbose();
const cheerio = require("cheerio");
const app = express();
const uuid = require('uuid');
const archiver = require('archiver');
app.use(express.json()); // Adicione esta linha
app.use(express.urlencoded({ extended: true }));
app.use(cors()); // Habilita CORS para todas as rotas
const PORT = process.env.PORT || 4000;
const http = require('http'); 





// Caminho da pasta onde os arquivos estão armazenados
const FILES_DIR = path.join(__dirname, 'mangas');

// Caminho do banco de dados
const DB_PATH = path.join(__dirname, 'db.db');

const upload = multer({
  dest: path.join(__dirname, 'uploads'),
  limits: { fileSize: 10 * 7024 * 7024 }, // Limite de tamanho de 10 MB
  fileFilter: (req, file, cb) => {
    console.log("Arquivo recebido:", file); // Log para depuração
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Arquivo inválido. Apenas imagens são permitidas.'));
    }
    cb(null, true);
  },
});

// Funções principais
const functions_main = {
  function_criar_pastas: function () {
    if (!fs.existsSync(FILES_DIR)) {
      fs.mkdirSync(FILES_DIR, { recursive: true }); // Cria a pasta, incluindo subpastas, se necessário
      console.log(`A pasta "${FILES_DIR}" foi criada.`);
    }
  },

  function_iniciarbancodedados: function() {
    const db = new sqlite3.Database(DB_PATH);

    db.serialize(() => {
      // Cria a tabela para armazenar versões, se não existir
      db.run(`
        CREATE TABLE IF NOT EXISTS versions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          version INTEGER NOT NULL UNIQUE,
          file_name TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) {
          console.error('Erro ao criar tabela "versions":', err);
        } else {
          console.log('Tabela "versions" criada ou já existe.');
        }
      });
    
      // Cria a tabela para armazenar as licenças de template de site, se não existir
      db.run(`
        CREATE TABLE IF NOT EXISTS site_licenses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          url TEXT NOT NULL,
          site_usuario TEXT NOT NULL,
          license_key TEXT NOT NULL UNIQUE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) {
          console.error('Erro ao criar tabela "site_licenses":', err);
        } else {
          console.log('Tabela "site_licenses" criada ou já existe.');
        }
      });
    });
    return db;

  },
};

// Configurações principais
function settings_main() {
  functions_main.function_criar_pastas(); // Gera as pastas necessárias
}
settings_main();


const db = functions_main.function_iniciarbancodedados();

const functions_check_update = {
  getLastSavedVersion: function() {
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM versions ORDER BY version DESC LIMIT 1',
        (err, row) => {
          if (err) {
            reject(err);
          } else {
            resolve(row);
          }
        }
      );
    });

  },

  saveNewVersion: function(version, fileName) {
    return new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO versions (version, file_name) VALUES (?, ?)',
        [version, fileName],
        function (err) {
          if (err) {
            reject(err);
          } else {
            resolve(this.lastID); // Retorna o ID do novo registro
          }
        }
      );
    });
  },

  getLatestZipFile: function() {
    const files = fs.readdirSync(FILES_DIR);
    const zipFiles = files.filter(file => file.endsWith('.zip'));
  
    // Retorna o primeiro arquivo ZIP encontrado
    return zipFiles[0] || null;
  }
}
// Rota para verificar e baixar a nova versão
app.get('/check-update-template-mangas', async (req, res) => {
  try {
    const clientVersion = req.query.version; // Versão enviada pelo cliente
    const latestZipFile = functions_check_update.getLatestZipFile();

    if (!latestZipFile) {
      return res.status(404).json({ error: 'Nenhuma versão disponível.' });
    }

    // Verifica a última versão registrada no banco
    const lastSavedVersion = await functions_check_update.getLastSavedVersion();

    // Se não houver versões registradas ou a versão atual for diferente, considere como nova versão
    if (!lastSavedVersion || latestZipFile !== lastSavedVersion.file_name) {
      const newVersion = lastSavedVersion ? lastSavedVersion.version + 1 : 1; // Incrementa a versão
      await functions_check_update.saveNewVersion(newVersion, latestZipFile);
      console.log(`Versão ${newVersion} registrada no banco de dados.`);

      // Envia o arquivo para o cliente
      const filePath = path.join(FILES_DIR, latestZipFile);
      res.download(filePath, latestZipFile, (err) => {
        if (err) {
          console.error('Erro ao enviar o arquivo:', err);
          return res.status(500).json({ error: 'Erro ao baixar o arquivo.' });
        }
      });
    } else {
      return res.json({ message: 'Você já está usando a versão mais recente.' });
    }
  } catch (error) {
    console.error('Erro ao verificar a versão:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
});

// Função middleware para validar a chave de licença
// Middleware de validação de licença
function validarLicenca(req, res, next) {
  const { key } = req.query;  // Obtém a chave de licença da URL (query string)
  console.log("Query string recebida:", req.query);  // Imprime todo o objeto de query string
  console.log("Licença recebida:", key);  // Imprime a chave de licença específica
  if (!key) {
    return res.status(400).json({ error: 'Chave de licença é obrigatória.' });
  }

  db.get(
    'SELECT * FROM site_licenses WHERE license_key = ?',
    [key],
    (err, row) => {
      if (err) {
        console.error('Erro ao validar a licença:', err);
        return res.status(500).json({ error: 'Erro ao validar a licença.' });
      }

      if (!row) {
        return res.status(401).json({ error: 'Chave de licença inválida.' });
      }

      // Se a licença for válida, prosseguir com a requisição
      next();
    }
  );
}

app.post("/post-image", upload.single("file"), (req, res, next) => {
  // Copia a chave 'key' da URL para 'license_key' no corpo da requisição
  req.body.license_key = req.query.key;
  next(); // Continua para o próximo middleware
}, validarLicenca, async (req, res) => {
  // Recuperar a chave da API do parâmetro de consulta
  const apiKey = req.query.key;

  if (!apiKey) {
      return res.status(400).json({ error: "Chave da API não fornecida." });
  }

  // A chave da API já foi validada pelo middleware validarLicenca

  if (!req.file) {
      return res.status(400).json({ error: "Nenhum arquivo foi enviado." });
  }

  const rota_post_image = "https://postimg.cc/json?q=a";

  try {
      // Criar um buffer do arquivo para evitar erros com `fs.createReadStream()`
      const fileBuffer = fs.readFileSync(req.file.path);

      const formData = new FormData();
      formData.append("action", "upload");
      formData.append("numfiles", "1");
      formData.append("gallery", "");
      formData.append("adult", "");
      formData.append("ui", "");
      formData.append("optsize", "");
      formData.append("upload_referer", "https://www.phpbb.com");
      formData.append("mode", "");
      formData.append("lang", "");
      formData.append("content", "");
      formData.append("forumurl", "");
      formData.append("FileFormName", "file");
      formData.append("upload_session", "carmelitaeldora");
      formData.append("file", fileBuffer, req.file.originalname);

      // Enviar imagem para PostImage
      const response = await axios.post(rota_post_image, formData, {
          headers: {
              ...formData.getHeaders(),
          },
      });
      

      // Excluir o arquivo temporário após a resposta da API
      fs.unlinkSync(req.file.path);

      if (!response.data || !response.data.url) {
          return res.status(500).json({ error: "A API não retornou uma URL válida." });
      }

      const imageUrl = response.data.url;

      // Buscar HTML da página da imagem
      const pageResponse = await axios.get(imageUrl);
      const $ = cheerio.load(pageResponse.data);
      const imageLink = $('meta[property="og:image"]').attr("content");

      if (!imageLink) {
          return res.status(500).json({ error: "Não foi possível encontrar o link da imagem no HTML." });
      }

      return res.json({ imageLink });
  } catch (error) {
      console.error("Erro ao enviar a imagem:", error);

      if (req.file) {
          fs.unlinkSync(req.file.path);
      }

      return res.status(500).json({ error: "Erro ao enviar a imagem ou processar a resposta." });
  }
});

const IMGBB_API_KEY = "5eaafdfae6b3a69b577f5372ba3ddc65"; // Substitua pela sua API Key do imgbb

// Middleware para validar a chave de acesso à sua API
app.post("/post-imgbb", upload.single("file"), (req, res, next) => {
  // Copia a chave 'key' da URL para 'license_key' no corpo da requisição
  req.body.license_key = req.query.key;
  next(); // Continua para o próximo middleware
}, validarLicenca, async (req, res) => {
  // A chave de acesso à sua API já foi validada pelo middleware validarLicenca

  if (!req.file) {
    return res.status(400).json({ error: "Nenhum arquivo foi enviado." });
  }

  try {
    // Criar um FormData para enviar a imagem
    const formData = new FormData();
    formData.append("image", fs.createReadStream(req.file.path));

    // Enviar imagem para imgbb
    const response = await axios.post(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, formData, {
      headers: {
        ...formData.getHeaders(),
      },
    });

    // Excluir o arquivo temporário
    fs.unlinkSync(req.file.path);

    // Verificar se a API retornou um link válido
    if (!response.data || !response.data.data || !response.data.data.url) {
      return res.status(500).json({ error: "A API não retornou uma URL válida." });
    }

    return res.json({ imageLink: response.data.data.url });
  } catch (error) {
    console.error("Erro ao enviar a imagem:", error);

    if (req.file) {
      fs.unlinkSync(req.file.path);
    }

    return res.status(500).json({ error: "Erro ao enviar a imagem." });
  }
});



app.post('/gerar-licenca', (req, res) => {
  const { url, site_usuario } = req.body;

  // Verifique se os dados existem no corpo da requisição
  console.log(req.body);  // Isso ajuda a depurar e verificar o corpo da requisição

  if (!url || !site_usuario) {
    return res.status(400).json({ error: 'URL e site_usuario são obrigatórios.' });
  }

  // Gera uma chave de licença única
  const license_key = generateLicenseKey();

  // Insere a licença no banco de dados
  db.run(
    'INSERT INTO site_licenses (url, site_usuario, license_key) VALUES (?, ?, ?)',
    [url, site_usuario, license_key],
    function (err) {
      if (err) {
        console.error('Erro ao gerar licença:', err);
        return res.status(500).json({ error: 'Erro ao gerar a licença.' });
      }

      console.log('Licença gerada com sucesso:', license_key);
      return res.json({ license_key });
    }
  );
});

// Função para gerar uma chave de licença aleatória
function generateLicenseKey() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Rota para validar uma licença
app.post('/validate-license', (req, res) => {
  const { license_key } = req.body;

  // Verifica se a chave de licença foi fornecida
  if (!license_key) {
    return res.status(400).json({ error: 'Chave de licença é obrigatória.' });
  }

  // Extrai o domínio a partir do cabeçalho Origin ou Host
  const domain = req.get('Origin') || req.get('Referer') || req.get('Host');

  if (!domain) {
    return res.status(400).json({ error: 'Domínio não encontrado na requisição.' });
  }

  // Verifica se a licença existe no banco de dados
  db.get(
    'SELECT * FROM site_licenses WHERE license_key = ?',
    [license_key],
    (err, row) => {
      if (err) {
        console.error('Erro ao validar a licença:', err);
        return res.status(500).json({ error: 'Erro ao validar a licença.' });
      }

      if (!row) {
        return res.status(404).json({ error: 'Licença não encontrada.' });
      }

      // Atualiza a licença no banco de dados com o domínio do site
      db.run(
        'UPDATE site_licenses SET domain = ? WHERE license_key = ?',
        [domain, license_key],
        (updateErr) => {
          if (updateErr) {
            console.error('Erro ao atualizar a licença:', updateErr);
            return res.status(500).json({ error: 'Erro ao atualizar a licença.' });
          }

          console.log('Licença atualizada com sucesso para o domínio:', domain);
          return res.json({ message: 'Licença válida e domínio atualizado.', license_info: row });
        }
      );
    }
  );
});

app.get("/scrap-cap-mangaonline_biz", async (req, res) => {
  const chapterUrl = req.query.url;

  function getAbsoluteUrl(url) {
      const baseUrl = 'http://mangaonline.biz'; // Alterar conforme necessário
      return url.startsWith('/') ? `${baseUrl}${url}` : url;
  }

  if (!chapterUrl) {
      return res.status(400).json({ error: "URL do capítulo é obrigatória." });
  }

  const tempDir = path.join(__dirname, "temp", uuid.v4());
  const zipFilePath = path.join(tempDir, "chapter.zip");
  

  // Função para limpar arquivos temporários
  function cleanUp() {
      if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
      }
      if (fs.existsSync(zipFilePath)) {
          fs.unlinkSync(zipFilePath);
      }
  }

  try {
    // Fazendo requisição para a URL do capítulo
    const response = await axios.get(chapterUrl, {
        timeout: 60000, // 60 segundos
        headers: {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        },
        httpsAgent: new https.Agent({ keepAlive: true })
    });

    const $ = cheerio.load(response.data);
    const imageLinks = [];

    // Extraindo links das imagens do mangá
    $(".content p img").each((i, element) => {
        const imgSrc = $(element).attr("src");
        if (imgSrc && (imgSrc.endsWith(".jpg") || imgSrc.endsWith(".jpeg") || imgSrc.endsWith(".png") || imgSrc.endsWith(".webp"))) {
            imageLinks.push({ url: getAbsoluteUrl(imgSrc), name: `pagina-${i + 1}.jpg` });
        }
    });

    if (imageLinks.length === 0) {
        return res.status(404).json({ error: "Nenhuma imagem encontrada." });
    }

    // Criando pasta temporária, se não existir
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    // Função de retry para download
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    async function retryDownload(url, name, attempts = 3) {
        try {
            const response = await axios({
                url,
                method: "GET",
                responseType: "stream",
                timeout: 30000,  // 30 segundos de timeout
                httpsAgent: new https.Agent({ keepAlive: true })
            });

            const filePath = path.join(tempDir, name);
            const writer = fs.createWriteStream(filePath);
            response.data.pipe(writer);

            return new Promise((resolve, reject) => {
                writer.on("finish", resolve);
                writer.on("error", reject);
            });

        } catch (error) {
            if (attempts > 0) {
                console.log(`Timeout ocorreu para ${url}. Tentando novamente...`);
                await delay(2000);  // Atraso entre tentativas
                return retryDownload(url, name, attempts - 1);  // Retenta o download
            }
            throw new Error(`Falha ao baixar ${url} após ${3 - attempts} tentativas.`);
        }
    }

    // Função para controle de concorrência sem usar a biblioteca limit
    const maxConcurrentDownloads = 1; // Limite de 2 downloads simultâneos
    const downloadQueue = imageLinks.slice(); // Copiar a lista de links
    const activeDownloads = [];

    // Função para controlar o número de downloads simultâneos
    async function processDownloads() {
        while (downloadQueue.length > 0 || activeDownloads.length > 0) {
            // Se há espaço para mais downloads, inicie o próximo
            if (activeDownloads.length < maxConcurrentDownloads && downloadQueue.length > 0) {
                const { url, name } = downloadQueue.shift(); // Remove o primeiro item da fila
                const downloadPromise = retryDownload(url, name)
                    .finally(() => {
                        // Quando terminar o download, removemos da lista ativa
                        const index = activeDownloads.indexOf(downloadPromise);
                        if (index !== -1) activeDownloads.splice(index, 1);
                    });

                activeDownloads.push(downloadPromise); // Adiciona a promessa ativa
            }

            // Aguarda o primeiro download ser concluído antes de continuar
            await Promise.race(activeDownloads); 
        }
    }

    // Inicia o processamento dos downloads com controle de concorrência
    await processDownloads();

    // Compactando imagens em um arquivo ZIP
    const output = fs.createWriteStream(zipFilePath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => {
        console.log(`ZIP criado com sucesso: ${zipFilePath}`);
        // Enviando o arquivo ZIP para o cliente
        res.download(zipFilePath, "capitulo.zip", (err) => {
            if (err) {
                console.error("Erro ao enviar o arquivo:", err);
                return res.status(500).json({ error: "Erro ao enviar o arquivo ZIP." });
            }
            // Limpando arquivos temporários
            cleanUp();
        });
    });

    archive.on("error", (err) => {
        throw err;
    });

    archive.pipe(output);

    // Adicionando imagens ao arquivo ZIP
    fs.readdirSync(tempDir).forEach((file) => {
        const filePath = path.join(tempDir, file);
        archive.file(filePath, { name: file });
    });

    await archive.finalize();
} catch (error) {
    console.error("Erro:", error);
    cleanUp();
    if (error.code === "ECONNABORTED") {
        return res.status(408).json({ error: "Tempo limite da requisição excedido." });
    }
    if (error.response && error.response.status) {
        return res.status(error.response.status).json({ error: error.response.statusText });
    }
    res.status(500).json({ error: "Erro ao processar a requisição." });
}

});

async function getChapterUrls(mangaUrl) {
  try {
    const response = await axios.get(mangaUrl, {
      timeout: 30000, // 30 segundos
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      },
    });
    const $ = cheerio.load(response.data);
    const chapterUrls = []; // Usaremos um array para preservar a ordem inicial do site
    
    // Ajuste: Certifique-se de que o seletor esteja correto
    $(".episodios li .episodiotitle a").each((i, element) => {
      let chapterUrl = $(element).attr("href");

      if (chapterUrl) {
        // Verifica se o link é relativo e faz a correção para ser absoluto
        if (!chapterUrl.startsWith('http')) {
          chapterUrl = new URL(chapterUrl, mangaUrl).href;
        }
        chapterUrls.push(chapterUrl); // Adiciona ao array
      }
    });

    // Inverte a ordem para ficar de baixo para cima e remove duplicados
    const uniqueUrls = Array.from(new Set(chapterUrls.reverse())); 

    return uniqueUrls;
  } catch (error) {
    console.error("Erro ao pegar os links dos capítulos:", error);
    throw new Error("Não foi possível obter os links dos capítulos.");
  }
}
async function downloadChaptersAndCreateZip(chapterUrls) {
  const tempDir = path.join(__dirname, "temp");
  const finalZipPath = path.join(__dirname, "manga-completo.zip");

  // Limpar diretório temporário
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  fs.mkdirSync(tempDir);

  const maxConcurrentDownloads = 1;  // Limite de downloads simultâneos
  const chapterZipPaths = []; // Armazenará os caminhos dos arquivos ZIP baixados

  // Função para baixar os capítulos com controle de concorrência
  async function downloadChapter(chapterUrl, index) {
    try {
      const chapterZipUrl = `https://saikanet.online:4000/scrap-cap-mangaonline_biz?url=${chapterUrl}`;
      const response = await axios.get(chapterZipUrl, {
        responseType: "arraybuffer",
        timeout: 30000 // 30 segundos, ajuste conforme necessário
      });
  

      const zipFileName = `capitulo-${index + 1}.zip`;
      const zipFilePath = path.join(tempDir, zipFileName);
      fs.writeFileSync(zipFilePath, response.data);

      console.log(`Capítulo ${index + 1} baixado com sucesso.`);
      chapterZipPaths.push(zipFilePath);  // Armazena o caminho do arquivo
    } catch (error) {
      console.error(`Erro ao baixar capítulo ${index + 1}:`, error);
      throw new Error(`Falha ao baixar o capítulo ${index + 1}`);
    }
  }

  // Função para controlar o número de downloads simultâneos
  async function processChaptersWithLimit() {
    const promises = [];
    for (let i = 0; i < chapterUrls.length; i++) {
      // Quando o número de downloads simultâneos atingir o limite, aguarda o primeiro terminar
      if (promises.length >= maxConcurrentDownloads) {
        await Promise.race(promises);  // Aguarda a primeira promessa a ser resolvida
      }

      const chapterUrl = chapterUrls[i];
      const promise = downloadChapter(chapterUrl, i);
      promises.push(promise);
      
      // Quando a promessa for resolvida, a removemos da fila
      promise.finally(() => {
        const index = promises.indexOf(promise);
        if (index !== -1) promises.splice(index, 1);
      });
    }

    // Aguarda todas as promessas restantes
    await Promise.all(promises);
  }

  try {
    await processChaptersWithLimit();  // Processa os capítulos com o limite de concorrência

    // Criando um arquivo ZIP final para todos os capítulos
    const output = fs.createWriteStream(finalZipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    archive.pipe(output);

    // Adicionar cada arquivo ZIP de capítulo ao arquivo ZIP final
    for (let index = 0; index < chapterZipPaths.length; index++) {
      const zipPath = chapterZipPaths[index];
      try {
        archive.file(zipPath, { name: `capitulo-${index + 1}.zip` });
      } catch (err) {
        console.error(`Erro ao adicionar o arquivo ${zipPath} ao ZIP final:`, err);
        throw new Error(`Falha ao adicionar o arquivo ${zipPath} ao ZIP final.`);
      }
    }

    await archive.finalize();

    console.log("Arquivo ZIP final criado com sucesso:", finalZipPath);
    return finalZipPath;
  } catch (error) {
    console.error("Erro ao processar os capítulos:", error);
    throw new Error("Falha ao processar os capítulos.");
  }
}

app.get("/scrap-all-chapters", async (req, res) => {
  const mangaUrl = req.query.url;

  if (!mangaUrl) {
      return res.status(400).json({ error: "URL do mangá é obrigatória." });
  }

  try {
      const chapterUrls = await getChapterUrls(mangaUrl);
      console.log(chapterUrls);

      if (chapterUrls.length === 0) {
          return res.status(404).json({ error: "Nenhum capítulo encontrado." });
      }

      const finalZipPath = await downloadChaptersAndCreateZip(chapterUrls);
      console.log("Arquivo ZIP gerado:", finalZipPath);

      // Verificar se o arquivo ZIP existe e não está vazio
      if (!fs.existsSync(finalZipPath) || fs.statSync(finalZipPath).size === 0) {
          return res.status(500).json({ error: "Arquivo ZIP inválido." });
      }

      // Enviar o arquivo ZIP usando streams
      const fileStream = fs.createReadStream(finalZipPath);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename=manga-completo.zip');
      fileStream.pipe(res);

      // Limpeza após o envio
      fileStream.on('end', () => {
          try {
              fs.rmSync(path.join(__dirname, "temp"), { recursive: true, force: true });
              fs.unlinkSync(finalZipPath);
              console.log("Arquivos temporários removidos com sucesso.");
          } catch (error) {
              console.error("Erro ao remover arquivos temporários:", error);
          }
      });

      fileStream.on('error', (err) => {
          console.error("Erro ao enviar o arquivo:", err);
          res.status(500).json({ error: "Erro ao enviar o arquivo ZIP." });
      });

  } catch (error) {
      console.error("Erro ao processar os capítulos:", error);
      res.status(500).json({ error: "Erro ao processar os capítulos." });
  }
});

// Inicia o servidor
http.createServer(app).listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});