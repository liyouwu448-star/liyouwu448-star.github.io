/**
 * 漫剧智能体 - veFaaS Serverless 代理函数
 * 部署到火山引擎 veFaaS 后，提供 API 代理服务解决 CORS 问题
 *
 * 部署步骤：
 * 1. npm i -g @volcengine/vefaas-cli@latest
 * 2. vefaas login --sso  （浏览器登录火山引擎）
 * 3. vefaas inspect       （在项目目录检测框架）
 * 4. vefaas gateway list --first  （查看可用网关）
 * 5. vefaas deploy --newApp --gateway <gateway名称>
 * 6. vefaas env set --key SILICONFLOW_API_KEY --value sk-xxx  （配置密钥）
 * 7. vefaas domains       （查看访问URL）
 *
 * 将获取的URL填入前端设置页的「API代理服务器地址」中
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

// ========== API密钥（从环境变量读取） ==========
function getApiKeys() {
  return {
    siliconflow: process.env.SILICONFLOW_API_KEY || '',
    doubao: process.env.DOUBAO_API_KEY || '',
    openai: process.env.OPENAI_API_KEY || '',
    anthropic: process.env.ANTHROPIC_API_KEY || '',
    deepseek: process.env.DEEPSEEK_API_KEY || '',
    zhipu: process.env.ZHIPU_API_KEY || '',
    qwen: process.env.QWEN_API_KEY || '',
    moonshot: process.env.MOONSHOT_API_KEY || '',
    minimax: process.env.MINIMAX_API_KEY || '',
    stability: process.env.STABILITY_API_KEY || '',
  };
}

// ========== 各平台API配置 ==========
const PROVIDERS = {
  siliconflow: { endpoint: 'https://api.siliconflow.cn/v1/chat/completions', headerKey: 'Authorization', headerPrefix: 'Bearer ', keyName: 'siliconflow' },
  doubao: { endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions', headerKey: 'Authorization', headerPrefix: 'Bearer ', keyName: 'doubao' },
  openai: { endpoint: 'https://api.openai.com/v1/chat/completions', headerKey: 'Authorization', headerPrefix: 'Bearer ', keyName: 'openai' },
  anthropic: { endpoint: 'https://api.anthropic.com/v1/messages', headerKey: 'x-api-key', headerPrefix: '', extraHeaders: { 'anthropic-version': '2023-06-01' }, keyName: 'anthropic' },
  deepseek: { endpoint: 'https://api.deepseek.com/v1/chat/completions', headerKey: 'Authorization', headerPrefix: 'Bearer ', keyName: 'deepseek' },
  zhipu: { endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', headerKey: 'Authorization', headerPrefix: 'Bearer ', keyName: 'zhipu' },
  qwen: { endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', headerKey: 'Authorization', headerPrefix: 'Bearer ', keyName: 'qwen' },
  moonshot: { endpoint: 'https://api.moonshot.cn/v1/chat/completions', headerKey: 'Authorization', headerPrefix: 'Bearer ', keyName: 'moonshot' },
  minimax: { endpoint: 'https://api.minimax.chat/v1/text/chatcompletion_v2', headerKey: 'Authorization', headerPrefix: 'Bearer ', keyName: 'minimax' },
};

const IMAGE_PROVIDERS = {
  siliconflow: {
    endpoint: 'https://api.siliconflow.cn/v1/images/generations',
    keyName: 'siliconflow',
    buildBody: (prompt, model, w, h, num) => {
      const m = model || 'Kwai-Kolors/Kolors';
      const body = { model: m, prompt, image_size: `${w}x${h}`, batch_size: num || 1, num_inference_steps: 20 };
      if (m.indexOf('Kolors') >= 0) body.guidance_scale = 7.5;
      if (m.indexOf('FLUX') >= 0) body.num_inference_steps = 4;
      return body;
    },
    parseResult: (data) => (data.images && data.images[0] && data.images[0].url) || (data.data && data.data[0] && data.data[0].url) || null,
  },
  volcengine: {
    endpoint: 'https://ark.cn-beijing.volces.com/api/v3/images/generations',
    keyName: 'doubao',
    buildBody: (prompt, model, w, h) => ({ model: model || 'doubao-seedream-3-0-t2i-250515', prompt, size: `${w}x${h}`, response_format: 'url', watermark: false }),
    parseResult: (data) => (data.data && data.data[0] && data.data[0].url) || null,
  },
};

// ========== 工具函数 ==========
function makeRequest(url, options, bodyData) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const client = u.protocol === 'https:' ? https : http;
    const opts = {
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: options.method || 'POST',
      headers: options.headers || {},
    };
    const req = client.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (bodyData) req.write(bodyData);
    req.end();
  });
}

function jsonResponse(statusCode, body) {
  return {
    statusCode: statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
    body: JSON.stringify(body),
  };
}

// ========== 主处理函数 ==========
exports.handler = async function (event, context) {
  // 处理 CORS 预检
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
      body: '',
    };
  }

  const API_KEYS = getApiKeys();
  const path = event.path || (event.requestContext && event.requestContext.path) || '';
  const method = event.httpMethod || 'GET';

  // ===== 健康检查 =====
  if (path.endsWith('/api/health') && method === 'GET') {
    const configured = Object.entries(API_KEYS).filter(([_, v]) => v).map(([k]) => k);
    return jsonResponse(200, { status: 'ok', configuredProviders: configured, message: `已配置 ${configured.length} 个平台密钥` });
  }

  // ===== 获取已配置平台 =====
  if (path.endsWith('/api/providers') && method === 'GET') {
    const providers = {};
    Object.entries(PROVIDERS).forEach(([key, val]) => {
      providers[key] = { configured: !!API_KEYS[val.keyName] };
    });
    return jsonResponse(200, providers);
  }

  // ===== 聊天代理 =====
  if (path.endsWith('/api/chat') && method === 'POST') {
    let reqBody;
    try { reqBody = JSON.parse(event.body || '{}'); } catch (e) {
      return jsonResponse(400, { error: '无效的JSON' });
    }
    const { provider, model, messages, stream, temperature, max_tokens } = reqBody;

    if (!provider || !PROVIDERS[provider]) {
      return jsonResponse(400, { error: '无效的平台', supportedProviders: Object.keys(PROVIDERS) });
    }
    const p = PROVIDERS[provider];
    const apiKey = API_KEYS[p.keyName];
    if (!apiKey) {
      return jsonResponse(400, { error: `平台 ${provider} 未配置API密钥` });
    }

    try {
      let body;
      if (provider === 'anthropic') {
        const sys = messages.find(m => m.role === 'system');
        const others = messages.filter(m => m.role !== 'system');
        body = JSON.stringify({ model: model || 'claude-3-5-sonnet-20241022', max_tokens: max_tokens || 4096, temperature: temperature || 0.7, system: sys ? sys.content : undefined, messages: others, stream: stream || false });
      } else {
        body = JSON.stringify({ model, messages, stream: stream || false, temperature: temperature || 0.7, max_tokens: max_tokens || 4096 });
      }

      const headers = { 'Content-Type': 'application/json', [p.headerKey]: p.headerPrefix + apiKey, ...(p.extraHeaders || {}) };
      const result = await makeRequest(p.endpoint, { method: 'POST', headers }, body);

      return {
        statusCode: result.statusCode,
        headers: { ...result.headers, 'Access-Control-Allow-Origin': '*' },
        body: result.body,
      };
    } catch (err) {
      return jsonResponse(500, { error: '代理请求失败', message: err.message });
    }
  }

  // ===== 图像生成代理 =====
  if (path.endsWith('/api/image') && method === 'POST') {
    let reqBody;
    try { reqBody = JSON.parse(event.body || '{}'); } catch (e) {
      return jsonResponse(400, { error: '无效的JSON' });
    }
    const { provider = 'siliconflow', prompt, model, width = 1024, height = 1024, num_images = 1 } = reqBody;

    const p = IMAGE_PROVIDERS[provider];
    if (!p) {
      return jsonResponse(400, { error: '不支持的图像平台', supported: Object.keys(IMAGE_PROVIDERS) });
    }
    const apiKey = API_KEYS[p.keyName];
    if (!apiKey) {
      return jsonResponse(400, { error: `平台 ${provider} 未配置API密钥` });
    }

    try {
      const bodyData = p.buildBody(prompt, model, width, height, num_images);
      const body = JSON.stringify(bodyData);
      const headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey };

      const result = await makeRequest(p.endpoint, { method: 'POST', headers }, body);
      let parsed;
      try { parsed = JSON.parse(result.body); } catch (e) { parsed = null; }

      if (parsed) {
        const imgUrl = p.parseResult(parsed);
        if (imgUrl) {
          return jsonResponse(200, { images: [{ url: imgUrl }], data: [{ url: imgUrl }] });
        }
      }
      return { statusCode: result.statusCode, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: result.body };
    } catch (err) {
      return jsonResponse(500, { error: '图像生成失败', message: err.message });
    }
  }

  // ===== 404 =====
  return jsonResponse(404, { error: 'Not Found', path: path });
};
