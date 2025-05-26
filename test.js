import fetch from 'node-fetch';
import fs from 'fs';
import FormData from 'form-data';

async function testUpload() {
    const token = 'e211dbd3656be018cc97b148fa3f73c788494b1ec9ef15ad';
    const form = new FormData();
    form.append('files', fs.createReadStream('test.jpg'));

    const res = await fetch('http://14.18.248.25:2342/api/v1/photos/upload', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            ...form.getHeaders(),
        },
        body: form,
    });

    console.log(await res.text());
}
testUpload();
