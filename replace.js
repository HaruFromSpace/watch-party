
const fs = require('fs');
let content = fs.readFileSync('public/index.html', 'utf8');

const replacements = {
  'Room <span id=\"roomNameDisplay\"': 'Room 房间 <span id=\"roomNameDisplay\"',
  '<span class=\"btn-content\">Share Screen</span>': '<span class=\"btn-content\">Share 共享屏幕</span>',
  '<span class=\"btn-content\">Copy Invite</span>': '<span class=\"btn-content\">Invite 复制邀请</span>',
  '<span class=\"btn-content\">Switch Room</span>': '<span class=\"btn-content\">Switch 切换房间</span>',
  'Paste direct .mp4 link...': 'Paste .mp4 link... (粘贴视频链接...)',
  '<span class=\"btn-content\">Load</span>': '<span class=\"btn-content\">Load 加载</span>',
  'Auto Quality': 'Auto 自动',
  '<h3>Live Chat</h3>': '<h3>Live Chat (聊天)</h3>',
  'Search Tenor GIFs...': 'Search GIFs... (搜索动图...)',
  'Type a message...': 'Type a message... (输入消息...)',
  '<span class=\"btn-content\">Send</span>': '<span class=\"btn-content\">Send 发送</span>',
  '<h2>Enter the Void</h2>': '<h2>Enter the Room (进入房间)</h2>',
  '<p>Sync up and watch together seamlessly.</p>': '<p>Sync up and watch together seamlessly. (同步观看)</p>',
  'placeholder=\"Room ID\"': 'placeholder=\"Room ID (房间号)\"',
  'placeholder=\"Your Alias\"': 'placeholder=\"Your Name (你的名字)\"',
  '<span class=\"btn-content\">Initialize Connection</span>': '<span class=\"btn-content\">Connect 连接</span>',
  'Hold SHIFT over video to use Laser Pointer': 'Hold SHIFT over video to use Laser Pointer (按住 Shift 键使用激光笔)'
};

for (const [search, replace] of Object.entries(replacements)) {
  content = content.replace(search, replace);
}

fs.writeFileSync('public/index.html', content);

