/**
 * 漫剧智能体 - API代理服务器
 * 统一管理API密钥，前端通过代理调用各平台API，密钥不暴露给浏览器
 */

const express = require('express');
const cors = require('cors');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('.'));

// ========== API密钥配置（在这里配置你的密钥） ==========
const API_KEYS = {
  // 硅基流动 SiliconFlow
  siliconflow: process.env.SILICONFLOW_API_KEY || '',
  // 豆包/火山引擎
  doubao: process.env.DOUBAO_API_KEY || '',
  // OpenAI
  openai: process.env.OPENAI_API_KEY || '',
  // Anthropic Claude
  anthropic: process.env.ANTHROPIC_API_KEY || '',
  // DeepSeek 官方
  deepseek: process.env.DEEPSEEK_API_KEY || '',
  // 智谱 GLM
  zhipu: process.env.ZHIPU_API_KEY || '',
  // 通义千问
  qwen: process.env.QWEN_API_KEY || '',
  // Kimi/Moonshot
  moonshot: process.env.MOONSHOT_API_KEY || '',
  // MiniMax
  minimax: process.env.MINIMAX_API_KEY || '',
  // Stability AI
  stability: process.env.STABILITY_API_KEY || '',
};

// ========== 各平台API配置 ==========
const PROVIDERS = {
  siliconflow: {
    endpoint: 'https://api.siliconflow.cn/v1/chat/completions',
    headerKey: 'Authorization',
    headerPrefix: 'Bearer ',
    keyName: 'siliconflow',
  },
  doubao: {
    endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    headerKey: 'Authorization',
    headerPrefix: 'Bearer ',
    keyName: 'doubao',
  },
  openai: {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    headerKey: 'Authorization',
    headerPrefix: 'Bearer ',
    keyName: 'openai',
  },
  anthropic: {
    endpoint: 'https://api.anthropic.com/v1/messages',
    headerKey: 'x-api-key',
    headerPrefix: '',
    extraHeaders: { 'anthropic-version': '2023-06-01' },
    keyName: 'anthropic',
  },
  deepseek: {
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    headerKey: 'Authorization',
    headerPrefix: 'Bearer ',
    keyName: 'deepseek',
  },
  zhipu: {
    endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    headerKey: 'Authorization',
    headerPrefix: 'Bearer ',
    keyName: 'zhipu',
  },
  qwen: {
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    headerKey: 'Authorization',
    headerPrefix: 'Bearer ',
    keyName: 'qwen',
  },
  moonshot: {
    endpoint: 'https://api.moonshot.cn/v1/chat/completions',
    headerKey: 'Authorization',
    headerPrefix: 'Bearer ',
    keyName: 'moonshot',
  },
  minimax: {
    endpoint: 'https://api.minimax.chat/v1/text/chatcompletion_v2',
    headerKey: 'Authorization',
    headerPrefix: 'Bearer ',
    keyName: 'minimax',
  },
};

// ========== 健康检查 ==========
app.get('/api/health', (req, res) => {
  const configured = Object.entries(API_KEYS)
    .filter(([_, v]) => v)
    .map(([k]) => k);
  res.json({ 
    status: 'ok', 
    configuredProviders: configured,
    message: `已配置 ${configured.length} 个平台密钥`
  });
});

// ========== 获取已配置的平台列表（不返回密钥） ==========
app.get('/api/providers', (req, res) => {
  const providers = {};
  Object.entries(PROVIDERS).forEach(([key, val]) => {
    providers[key] = {
      configured: !!API_KEYS[val.keyName],
    };
  });
  res.json(providers);
});

// ========== 聊天代理接口（支持流式） ==========
app.post('/api/chat', async (req, res) => {
  const { provider, model, messages, stream, temperature, max_tokens } = req.body;

  if (!provider || !PROVIDERS[provider]) {
    return res.status(400).json({ error: '无效的平台', supportedProviders: Object.keys(PROVIDERS) });
  }

  const p = PROVIDERS[provider];
  const apiKey = API_KEYS[p.keyName];

  if (!apiKey) {
    return res.status(400).json({ error: `平台 ${provider} 未配置API密钥，请在服务器端配置` });
  }

  try {
    const url = new URL(p.endpoint);
    const client = url.protocol === 'https:' ? https : http;

    // 构建请求体
    let body;
    if (provider === 'anthropic') {
      // Anthropic 特殊格式
      const systemMsg = messages.find(m => m.role === 'system');
      const otherMsgs = messages.filter(m => m.role !== 'system');
      body = JSON.stringify({
        model: model || 'claude-3-5-sonnet-20241022',
        max_tokens: max_tokens || 4096,
        temperature: temperature || 0.7,
        system: systemMsg ? systemMsg.content : undefined,
        messages: otherMsgs,
        stream: stream || false,
      });
    } else {
      // OpenAI 兼容格式
      body = JSON.stringify({
        model: model,
        messages: messages,
        stream: stream || false,
        temperature: temperature || 0.7,
        max_tokens: max_tokens || 4096,
      });
    }

    const headers = {
      'Content-Type': 'application/json',
      [p.headerKey]: p.headerPrefix + apiKey,
      ...(p.extraHeaders || {}),
    };

    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: headers,
    };

    const proxyReq = client.request(options, (proxyRes) => {
      // 转发响应头
      res.writeHead(proxyRes.statusCode, proxyRes.headers);

      if (stream) {
        // 流式响应直接转发
        proxyRes.pipe(res);
      } else {
        // 非流式响应收集后返回
        let data = '';
        proxyRes.on('data', (chunk) => { data += chunk; });
        proxyRes.on('end', () => {
          try {
            const json = JSON.parse(data);
            res.json(json);
          } catch (e) {
            res.send(data);
          }
        });
      }
    });

    proxyReq.on('error', (err) => {
      console.error('代理请求错误:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: '代理请求失败', message: err.message });
      }
    });

    proxyReq.write(body);
    proxyReq.end();

  } catch (err) {
    console.error('API调用错误:', err);
    res.status(500).json({ error: '服务器错误', message: err.message });
  }
});

// ========== 图像生成代理 ==========
const IMAGE_PROVIDERS = {
  siliconflow: {
    endpoint: 'https://api.siliconflow.cn/v1/images/generations',
    keyName: 'siliconflow',
    defaultModel: 'Kwai-Kolors/Kolors',
    buildBody: (prompt, model, width, height, num) => {
      const m = model || 'Kwai-Kolors/Kolors';
      const body = {
        model: m,
        prompt: prompt,
        image_size: `${width}x${height}`,
        batch_size: num || 1,
        num_inference_steps: 20,
      };
      if (m.indexOf('Kolors') >= 0) body.guidance_scale = 7.5;
      if (m.indexOf('FLUX') >= 0) body.num_inference_steps = 4;
      return body;
    },
    parseResult: (data) => {
      if (data.images && data.images[0] && data.images[0].url) return data.images[0].url;
      if (data.data && data.data[0] && data.data[0].url) return data.data[0].url;
      return null;
    }
  },
  volcengine: {
    endpoint: 'https://ark.cn-beijing.volces.com/api/v3/images/generations',
    keyName: 'doubao',
    defaultModel: 'doubao-seedream-3-0-t2i-250515',
    buildBody: (prompt, model, width, height) => {
      return {
        model: model || 'doubao-seedream-3-0-t2i-250515',
        prompt: prompt,
        size: `${width}x${height}`,
        response_format: 'url',
        watermark: false,
      };
    },
    parseResult: (data) => {
      if (data.data && data.data[0] && data.data[0].url) return data.data[0].url;
      return null;
    }
  },
  dashscope: {
    endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis',
    keyName: 'qwen',
    defaultModel: 'wanx2.1-t2i-turbo',
    buildBody: (prompt, model) => {
      return {
        model: model || 'wanx2.1-t2i-turbo',
        input: { prompt: prompt },
        parameters: { size: '1024*1024', n: 1 },
      };
    },
    parseResult: (data) => {
      // Dashscope is async - return task info
      if (data.output && data.output.task_id) {
        return { asyncTask: data.output.task_id, requestId: data.request_id };
      }
      return null;
    }
  },
  stability: {
    endpoint: 'https://api.stability.ai/v2beta/stable-image/generate/sd3',
    keyName: 'stability',
    defaultModel: 'sd3.5-large',
    buildBody: (prompt, model, width, height) => {
      // Stability uses multipart form data
      return null;
    },
    parseResult: (data) => {
      if (data.image) return 'data:image/png;base64,' + data.image;
      return null;
    }
  },
};

app.post('/api/image', async (req, res) => {
  const { provider = 'siliconflow', prompt, model, width = 1024, height = 1024, num_images = 1 } = req.body;

  const p = IMAGE_PROVIDERS[provider];
  if (!p) {
    return res.status(400).json({ error: '不支持的图像平台', supported: Object.keys(IMAGE_PROVIDERS) });
  }

  const apiKey = API_KEYS[p.keyName];
  if (!apiKey) {
    return res.status(400).json({ error: `平台 ${provider} 未配置API密钥，请在服务器环境变量中配置 ${p.keyName.toUpperCase()}_API_KEY` });
  }

  try {
    const url = new URL(p.endpoint);
    const client = url.protocol === 'https:' ? https : http;

    const bodyData = p.buildBody(prompt, model, width, height, num_images);

    // Stability uses multipart form data
    if (provider === 'stability') {
      const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
      const formData = Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="prompt"\r\n\r\n${prompt}\r\n` +
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="model"\r\n\r\n${model || 'sd3.5-large'}\r\n` +
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="output_format"\r\n\r\npng\r\n` +
        `--${boundary}--\r\n`
      );

      const options = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Authorization': 'Bearer ' + apiKey,
          'Accept': 'application/json',
          'Content-Length': formData.length,
        },
      };

      const proxyReq = client.request(options, (proxyRes) => {
        let data = '';
        proxyRes.on('data', (chunk) => { data += chunk; });
        proxyRes.on('end', () => {
          res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
          res.send(data);
        });
      });
      proxyReq.on('error', (err) => {
        if (!res.headersSent) res.status(500).json({ error: '图像生成失败', message: err.message });
      });
      proxyReq.write(formData);
      proxyReq.end();
      return;
    }

    // Standard JSON API
    const body = JSON.stringify(bodyData);

    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
    };

    const proxyReq = client.request(options, (proxyRes) => {
      let data = '';
      proxyRes.on('data', (chunk) => { data += chunk; });
      proxyRes.on('end', () => {
        try {
          const json = JSON.parse(data);
          const imgUrl = p.parseResult(json);
          if (imgUrl) {
            if (typeof imgUrl === 'object' && imgUrl.asyncTask) {
              // Async task (Dashscope)
              res.json({ asyncTask: imgUrl.asyncTask, requestId: imgUrl.requestId, message: '任务已提交，请稍后查询结果' });
            } else {
              res.json({ images: [{ url: imgUrl }], data: [{ url: imgUrl }] });
            }
          } else {
            res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
            res.send(data);
          }
        } catch (e) {
          res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
          res.send(data);
        }
      });
    });

    proxyReq.on('error', (err) => {
      console.error('图像生成错误:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: '图像生成失败', message: err.message });
      }
    });

    proxyReq.write(body);
    proxyReq.end();
  } catch (err) {
    console.error('图像生成服务器错误:', err);
    res.status(500).json({ error: '服务器错误', message: err.message });
  }
});

// ========== TTS 豆包语音代理 ==========
app.post('/api/tts', async (req, res) => {
  const { text, voice_type } = req.body;
  const apiKey = API_KEYS.doubao;

  if (!apiKey) {
    return res.status(400).json({ error: '未配置豆包API密钥，无法使用TTS' });
  }

  // 这里可以接入豆包TTS API
  res.json({ error: 'TTS功能需要单独接入豆包语音API' });
});

// ========== 启动服务器 ==========
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║       漫剧智能体 - API代理服务器已启动         ║
╠══════════════════════════════════════════════╣
║  本地访问: http://localhost:${PORT}             ║
║                                              ║
║  已配置平台:                                   ║`);
  Object.entries(API_KEYS).forEach(([k, v]) => {
    const status = v ? '✓ 已配置' : '✗ 未配置';
    console.log(`║    ${k.padEnd(12)} ${status.padEnd(20)} ║`);
  });
  console.log(`╚══════════════════════════════════════════════╝
  `);
});
