import express from 'express';
import multer from 'multer';
import { createClient } from 'webdav';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const uploadFolder = path.join(__dirname, 'uploads');

// 确保上传目录存在
if (!fs.existsSync(uploadFolder)){
    fs.mkdirSync(uploadFolder, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadFolder);
    },
    filename: function (req, file, cb) {
        cb(null, file.originalname);
    }
});

const fileFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('只允许上传图片文件'), false);
    }
};

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 限制单个文件大小为 10MB
    fileFilter: fileFilter
});

const PORT = process.env.PORT || 3000;

const WEBDAV_URL = process.env.WEBDAV_URL; // 例如 http://14.18.248.25:2342/originals/
const WEBDAV_USER = process.env.WEBDAV_USER; // 例如 admin
const WEBDAV_PASSWORD = process.env.WEBDAV_PASSWORD; // 密码

if (!WEBDAV_URL || !WEBDAV_USER || !WEBDAV_PASSWORD) {
    console.error('请在 .env 文件中配置 WEBDAV_URL、WEBDAV_USER 和 WEBDAV_PASSWORD');
    process.exit(1);
}

const client = createClient(
    WEBDAV_URL,
    {
        username: WEBDAV_USER,
        password: WEBDAV_PASSWORD
    }
);

// 处理上传请求
app.post('/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: '上传文件为空' });
        }

        console.log(`准备上传文件：${req.file.originalname}，大小：${req.file.size} bytes`);

        // 获取当前日期
        const currentDate = new Date().toISOString().split('T')[0];

        // 创建文件夹路径
        const folderPath = `/${currentDate}/`;

        // 检查文件夹是否存在，如果不存在则创建
        const exists = await client.exists(folderPath);
        if (!exists) {
            await client.createDirectory(folderPath, { recursive: true });
            console.log(`文件夹已创建：${folderPath}`);
        } else {
            console.log(`文件夹已存在：${folderPath}`);
        }

        // 上传文件到对应的文件夹
        const filePath = `${folderPath}${req.file.originalname}`;
        await client.putFileContents(filePath, fs.readFileSync(req.file.path), { overwrite: true });

        // 删除临时文件
        fs.unlinkSync(req.file.path);

        console.log(`上传成功，文件已写入 WebDAV 的 ${filePath}`);

        return res.json({ status: 'success', message: `上传成功（WebDAV）到 ${filePath}` });
    } catch (err) {
        console.error('上传失败:', err);
        return res.status(500).json({ error: '上传失败', details: err.message });
    }
});

// 静态资源托管
app.use(express.static(path.join(__dirname, 'public')));

// 根路径返回 index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server 运行在 http://localhost:${PORT}`);
});
