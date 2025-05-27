import express from 'express';
import multer from 'multer';
import { createClient } from 'webdav';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import https from 'https';
import crypto from 'crypto';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const uploadFolder = path.join(__dirname, 'uploads');

// 确保上传目录存在
if (!fs.existsSync(uploadFolder)) {
    fs.mkdirSync(uploadFolder, { recursive: true });
    console.log(`上传目录已创建: ${uploadFolder}`);
} else {
    console.log(`上传目录已存在: ${uploadFolder}`);
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadFolder),
    filename: (req, file, cb) => cb(null, file.originalname)
});

const fileFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('只允许上传图片文件'), false);
    }
};

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter
});

const PORT = process.env.PORT || 3000;

const WEBDAV_URL = process.env.WEBDAV_URL;
const WEBDAV_USER = process.env.WEBDAV_USER;
const WEBDAV_PASSWORD = process.env.WEBDAV_PASSWORD;
const SSL_KEY_PATH = process.env.SSL_KEY_PATH || '/etc/nginx/ssl/privkey.pem';
const SSL_CERT_PATH = process.env.SSL_CERT_PATH || '/etc/nginx/ssl/fullchain.pem';

if (!WEBDAV_URL || !WEBDAV_USER || !WEBDAV_PASSWORD) {
    console.error('请在 .env 文件中配置 WEBDAV_URL、WEBDAV_USER 和 WEBDAV_PASSWORD');
    process.exit(1);
}

function checkPemFormat(pemContent, type) {
    if (type === 'key') {
        return pemContent.includes('-----BEGIN') && (
            pemContent.includes('PRIVATE KEY-----') || pemContent.includes('ENCRYPTED PRIVATE KEY-----')
        );
    } else if (type === 'cert') {
        return pemContent.includes('-----BEGIN CERTIFICATE-----');
    }
    return false;
}

function verifyKeyCertMatch(keyPem, certPem) {
    try {
        // 使用 crypto.createPrivateKey 和 crypto.X509Certificate 进行匹配验证
        const privateKeyObject = crypto.createPrivateKey(keyPem);
        const certObject = new crypto.X509Certificate(certPem);

        const publicKeyFromCert = certObject.publicKey.export({ type: 'spki', format: 'pem' });
        const publicKeyFromKey = crypto.createPublicKey(privateKeyObject).export({ type: 'spki', format: 'pem' });

        return publicKeyFromCert === publicKeyFromKey;
    } catch (error) {
        console.error('验证私钥和证书匹配时出错:', error);
        return false;
    }
}

// 读取并验证证书和私钥
let keyPem, certPem;
try {
    keyPem = fs.readFileSync(SSL_KEY_PATH, 'utf8');
    certPem = fs.readFileSync(SSL_CERT_PATH, 'utf8');
    console.log(`读取 SSL 私钥 长度: ${keyPem.length}`);
    console.log(`读取 SSL 证书 长度: ${certPem.length}`);

    if (!checkPemFormat(keyPem, 'key')) {
        throw new Error('私钥文件格式错误（未检测到正确的 BEGIN PRIVATE KEY 标识）');
    }
    if (!checkPemFormat(certPem, 'cert')) {
        throw new Error('证书文件格式错误（未检测到正确的 BEGIN CERTIFICATE 标识）');
    }

    if (!verifyKeyCertMatch(keyPem, certPem)) {
        throw new Error('私钥和证书内容不匹配');
    }
    console.log('私钥和证书验证通过');
} catch (error) {
    console.error('读取 SSL 证书或私钥失败:', error);
    process.exit(1);
}

const client = createClient(
    WEBDAV_URL,
    {
        username: WEBDAV_USER,
        password: WEBDAV_PASSWORD
    }
);

// 上传接口
app.post('/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: '上传文件为空' });

        console.log(`准备上传文件：${req.file.originalname}，大小：${req.file.size} bytes`);

        const latitude = req.body.latitude;
        const longitude = req.body.longitude;

        if (latitude && longitude) {
            console.log(`位置信息：纬度: ${latitude}, 经度: ${longitude}`);
        } else {
            console.log('未收到位置信息');
        }

        const currentDate = new Date().toISOString().split('T')[0];
        const folderPath = `/${currentDate}/`;

        const exists = await client.exists(folderPath);
        if (!exists) {
            await client.createDirectory(folderPath, { recursive: true });
            console.log(`文件夹已创建：${folderPath}`);
        } else {
            console.log(`文件夹已存在：${folderPath}`);
        }

        const filePath = `${folderPath}${req.file.originalname}`;
        await client.putFileContents(filePath, fs.readFileSync(req.file.path), { overwrite: true });

        // 创建一个包含位置信息的JSON文件
        if (latitude && longitude) {
            const metadata = {
                filename: req.file.originalname,
                location: {
                    latitude: parseFloat(latitude),
                    longitude: parseFloat(longitude)
                },
                timestamp: new Date().toISOString()
            };
            const metadataPath = `${folderPath}${req.file.originalname}.json`;
            await client.putFileContents(metadataPath, JSON.stringify(metadata), { overwrite: true });
            console.log(`位置信息已写入 WebDAV 的 ${metadataPath}`);
        }

        fs.unlinkSync(req.file.path);

        console.log(`上传成功，文件已写入 WebDAV 的 ${filePath}`);

        res.json({ status: 'success', message: `上传成功（WebDAV）到 ${filePath}` });
    } catch (err) {
        console.error('上传失败:', err);
        res.status(500).json({ error: '上传失败', details: err.message });
    }
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const httpsServer = https.createServer({ key: keyPem, cert: certPem }, app);

httpsServer.listen(PORT, () => {
    console.log(`HTTPS Server 运行在 https://localhost:${PORT}`);
});
