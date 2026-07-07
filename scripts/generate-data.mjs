/**
 * Generates public/graph.json — the poet constellation dataset.
 *
 * A curated core of real poets and documented poem-exchange relationships is
 * expanded procedurally to ~500 nodes / ~3000 links so the visualization can
 * be exercised at full scale. Procedurally generated poets/links are marked
 * with `generated: true` and carry placeholder evidence notes, not real poems.
 *
 * Run: npm run generate-data
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Deterministic PRNG so the dataset is reproducible.
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260703);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const randInt = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
const gauss = () => (rand() + rand() + rand() - 1.5) / 1.5; // ~[-1,1], center-weighted

// ---------------------------------------------------------------------------
// Communities
// ---------------------------------------------------------------------------
// Milky, desaturated astrophoto palette: silvery blues with faint warm/pink
// accents, so clusters read like regions of one galaxy instead of candy blobs.
// Ids 0–9 hold the curated real poets; 10+ are additional dynasty communities
// filled procedurally so the map spans all major eras (先秦 → 近现代).
const GROUPS = [
  { id: 0, name: '建安·魏晋', color: '#b8c8ea' },
  { id: 1, name: '初唐', color: '#c9d5f2' },
  { id: 2, name: '盛唐·山水田园', color: '#b7dcd2' },
  { id: 3, name: '盛唐·边塞', color: '#e8cfae' },
  { id: 4, name: '李杜交游', color: '#f2e3bd' },
  { id: 5, name: '中唐·元白', color: '#e5bcd2' },
  { id: 6, name: '中唐·韩孟', color: '#cfc2ea' },
  { id: 7, name: '晚唐', color: '#e2c6b3' },
  { id: 8, name: '北宋', color: '#b5cfe8' },
  { id: 9, name: '南宋', color: '#c5dcea' },
  { id: 10, name: '先秦·两汉', color: '#d9c9a6' },
  { id: 11, name: '南北朝', color: '#a8c2d6' },
  { id: 12, name: '隋·唐音', color: '#cdd8ee' },
  { id: 13, name: '五代·词', color: '#e0bcc8' },
  { id: 14, name: '辽金', color: '#a6c4c0' },
  { id: 15, name: '元曲', color: '#e8c4a0' },
  { id: 16, name: '明', color: '#bcd0e6' },
  { id: 17, name: '清', color: '#cabfe2' },
  { id: 18, name: '近现代', color: '#c8dce0' },
];

// Spiral-galaxy layout: each community (in dynasty/chronological order) is a
// spiral arm winding out of the galactic core in the XZ plane, with a thin
// disc profile in Y (thicker toward the central bulge).
const ARM_R_CORE = 90; // arms emerge outside the bulge, so they never merge
const ARM_R_MAX = 300; // outer edge of the disc (compact, dense galaxy)
const ARM_WIND = 2.6; // radians an arm winds from core to edge

// ---------------------------------------------------------------------------
// Curated real poets  [name, courtesyName, dynasty, poemCount, group, isHub]
// ---------------------------------------------------------------------------
const CURATED_POETS = [
  // 建安·魏晋
  ['曹操', '孟德', '汉魏', 26, 0, true],
  ['曹丕', '子桓', '汉魏', 40, 0, false],
  ['曹植', '子建', '汉魏', 80, 0, true],
  ['王粲', '仲宣', '汉魏', 26, 0, false],
  ['刘桢', '公干', '汉魏', 15, 0, false],
  ['阮籍', '嗣宗', '魏晋', 82, 0, true],
  ['嵇康', '叔夜', '魏晋', 60, 0, false],
  ['陶渊明', '元亮', '东晋', 125, 0, true],
  ['谢灵运', '', '南朝', 100, 0, false],
  ['鲍照', '明远', '南朝', 200, 0, false],
  // 初唐
  ['王勃', '子安', '唐', 90, 1, true],
  ['杨炯', '', '唐', 33, 1, false],
  ['卢照邻', '升之', '唐', 100, 1, false],
  ['骆宾王', '观光', '唐', 130, 1, false],
  ['陈子昂', '伯玉', '唐', 127, 1, true],
  ['宋之问', '延清', '唐', 190, 1, false],
  ['沈佺期', '云卿', '唐', 150, 1, false],
  ['张若虚', '', '唐', 2, 1, false],
  ['贺知章', '季真', '唐', 19, 1, true],
  ['张九龄', '子寿', '唐', 193, 1, false],
  // 盛唐·山水田园
  ['王维', '摩诘', '唐', 400, 2, true],
  ['孟浩然', '浩然', '唐', 260, 2, true],
  ['储光羲', '', '唐', 200, 2, false],
  ['常建', '', '唐', 57, 2, false],
  ['裴迪', '', '唐', 29, 2, false],
  ['祖咏', '', '唐', 36, 2, false],
  ['綦毋潜', '孝通', '唐', 26, 2, false],
  ['韦应物', '义博', '唐', 550, 2, true],
  ['刘长卿', '文房', '唐', 500, 2, false],
  // 盛唐·边塞
  ['高适', '达夫', '唐', 250, 3, true],
  ['岑参', '', '唐', 400, 3, true],
  ['王昌龄', '少伯', '唐', 180, 3, true],
  ['王之涣', '季凌', '唐', 6, 3, false],
  ['李颀', '', '唐', 120, 3, false],
  ['崔颢', '', '唐', 40, 3, false],
  ['王翰', '子羽', '唐', 13, 3, false],
  // 李杜交游
  ['李白', '太白', '唐', 1010, 4, true],
  ['杜甫', '子美', '唐', 1450, 4, true],
  ['汪伦', '', '唐', 1, 4, false],
  ['元丹丘', '', '唐', 2, 4, false],
  ['贾至', '幼邻', '唐', 46, 4, false],
  ['郑虔', '趋庭', '唐', 3, 4, false],
  ['严武', '季鹰', '唐', 6, 4, false],
  ['元结', '次山', '唐', 100, 4, false],
  // 中唐·元白
  ['白居易', '乐天', '唐', 2800, 5, true],
  ['元稹', '微之', '唐', 830, 5, true],
  ['刘禹锡', '梦得', '唐', 800, 5, true],
  ['柳宗元', '子厚', '唐', 180, 5, false],
  ['李绅', '公垂', '唐', 130, 5, false],
  ['张籍', '文昌', '唐', 450, 5, false],
  ['王建', '仲初', '唐', 500, 5, false],
  ['钱起', '仲文', '唐', 430, 5, false],
  ['卢纶', '允言', '唐', 330, 5, false],
  ['李益', '君虞', '唐', 180, 5, false],
  ['戴叔伦', '幼公', '唐', 300, 5, false],
  // 中唐·韩孟
  ['韩愈', '退之', '唐', 400, 6, true],
  ['孟郊', '东野', '唐', 500, 6, true],
  ['贾岛', '浪仙', '唐', 400, 6, false],
  ['李贺', '长吉', '唐', 240, 6, true],
  ['卢仝', '', '唐', 100, 6, false],
  ['皇甫湜', '持正', '唐', 3, 6, false],
  ['张继', '懿孙', '唐', 50, 6, false],
  // 晚唐
  ['李商隐', '义山', '唐', 600, 7, true],
  ['杜牧', '牧之', '唐', 520, 7, true],
  ['温庭筠', '飞卿', '唐', 350, 7, true],
  ['韦庄', '端己', '唐', 320, 7, false],
  ['罗隐', '昭谏', '唐', 500, 7, false],
  ['皮日休', '袭美', '唐', 400, 7, false],
  ['陆龟蒙', '鲁望', '唐', 600, 7, false],
  ['杜荀鹤', '彦之', '唐', 330, 7, false],
  ['许浑', '用晦', '唐', 530, 7, false],
  // 北宋
  ['苏轼', '子瞻', '北宋', 2700, 8, true],
  ['苏辙', '子由', '北宋', 1800, 8, false],
  ['苏洵', '明允', '北宋', 50, 8, false],
  ['欧阳修', '永叔', '北宋', 860, 8, true],
  ['王安石', '介甫', '北宋', 1600, 8, true],
  ['黄庭坚', '鲁直', '北宋', 1900, 8, true],
  ['秦观', '少游', '北宋', 430, 8, false],
  ['晏殊', '同叔', '北宋', 340, 8, false],
  ['晏几道', '叔原', '北宋', 260, 8, false],
  ['柳永', '耆卿', '北宋', 210, 8, false],
  ['梅尧臣', '圣俞', '北宋', 2800, 8, false],
  ['张耒', '文潜', '北宋', 2200, 8, false],
  ['晁补之', '无咎', '北宋', 750, 8, false],
  ['陈师道', '履常', '北宋', 700, 8, false],
  ['米芾', '元章', '北宋', 300, 8, false],
  // 南宋
  ['陆游', '务观', '南宋', 9300, 9, true],
  ['杨万里', '廷秀', '南宋', 4200, 9, true],
  ['范成大', '致能', '南宋', 1900, 9, true],
  ['辛弃疾', '幼安', '南宋', 620, 9, true],
  ['朱熹', '元晦', '南宋', 1200, 9, false],
  ['姜夔', '尧章', '南宋', 180, 9, false],
  ['尤袤', '延之', '南宋', 60, 9, false],
  ['陈亮', '同甫', '南宋', 74, 9, false],
  ['刘过', '改之', '南宋', 500, 9, false],
  ['文天祥', '履善', '南宋', 800, 9, false],
  ['李清照', '易安', '两宋之际', 90, 9, true],
];

// ---------------------------------------------------------------------------
// Curated real relationships with real poem evidence.
// [source, target, weight, type, [title, author, content, relation]...]
// ---------------------------------------------------------------------------
const CURATED_LINKS = [
  ['杜甫', '李白', 10, '赠诗', [
    ['春日忆李白', '杜甫', '白也诗无敌,飘然思不群。清新庾开府,俊逸鲍参军。', '杜甫春日思念李白而作'],
    ['梦李白二首·其一', '杜甫', '故人入我梦,明我长相忆。恐非平生魂,路远不可测。', '李白流放夜郎,杜甫忧思成梦'],
    ['赠李白', '杜甫', '秋来相顾尚飘蓬,未就丹砂愧葛洪。痛饮狂歌空度日,飞扬跋扈为谁雄。', '两人同游齐鲁时相赠'],
  ]],
  ['李白', '杜甫', 9, '赠诗', [
    ['沙丘城下寄杜甫', '李白', '思君若汶水,浩荡寄南征。', '李白旅居沙丘怀念杜甫'],
    ['鲁郡东石门送杜二甫', '李白', '飞蓬各自远,且尽手中杯。', '石门分别,此后二人再未相见'],
  ]],
  ['李白', '孟浩然', 9, '送别', [
    ['黄鹤楼送孟浩然之广陵', '李白', '孤帆远影碧空尽,唯见长江天际流。', '李白于黄鹤楼送孟浩然东下扬州'],
    ['赠孟浩然', '李白', '吾爱孟夫子,风流天下闻。', '李白倾慕孟浩然高洁风度'],
  ]],
  ['李白', '汪伦', 7, '赠诗', [
    ['赠汪伦', '李白', '桃花潭水深千尺,不及汪伦送我情。', '汪伦踏歌送行,李白临别相赠'],
  ]],
  ['李白', '王昌龄', 8, '赠诗', [
    ['闻王昌龄左迁龙标遥有此寄', '李白', '我寄愁心与明月,随君直到夜郎西。', '王昌龄贬龙标,李白遥寄此诗'],
  ]],
  ['李白', '元丹丘', 7, '赠诗', [
    ['将进酒', '李白', '岑夫子,丹丘生,将进酒,杯莫停。', '与元丹丘、岑勋置酒高会'],
  ]],
  ['李白', '贺知章', 8, '悼亡', [
    ['对酒忆贺监二首·其一', '李白', '金龟换酒处,却忆泪沾巾。', '贺知章逝后,李白对酒追忆"谪仙人"之知遇'],
  ]],
  ['杜甫', '高适', 8, '唱和', [
    ['追酬故高蜀州人日见寄', '杜甫', '自蒙蜀州人日作,不意清诗久零落。', '高适逝后,杜甫检旧稿追酬其《人日寄杜二拾遗》'],
  ]],
  ['高适', '杜甫', 8, '赠诗', [
    ['人日寄杜二拾遗', '高适', '今年人日空相忆,明年人日知何处。', '高适人日寄诗成都草堂'],
  ]],
  ['杜甫', '岑参', 7, '赠诗', [
    ['寄彭州高三十五使君适虢州岑二十七长史参三十韵', '杜甫', '故人何寂寞,今我独凄凉。', '杜甫寄高适、岑参'],
  ]],
  ['岑参', '高适', 7, '唱和', [
    ['与高适薛据同登慈恩寺浮图', '岑参', '塔势如涌出,孤高耸天宫。', '同登慈恩寺塔唱和'],
  ]],
  ['杜甫', '严武', 7, '赠诗', [
    ['奉济驿重送严公四韵', '杜甫', '远送从此别,青山空复情。', '严武还朝,杜甫远送'],
  ]],
  ['杜甫', '郑虔', 6, '送别', [
    ['送郑十八虔贬台州司户', '杜甫', '便与先生应永诀,九重泉路尽交期。', '郑虔贬台州,杜甫伤别'],
  ]],
  ['王维', '孟浩然', 8, '送别', [
    ['送孟六归襄阳', '王维', '杜门不复出,久与世情疏。', '孟浩然求仕不遇,王维送其归襄阳'],
  ]],
  ['孟浩然', '王维', 8, '赠诗', [
    ['留别王维', '孟浩然', '欲寻芳草去,惜与故人违。', '孟浩然离长安时留别王维'],
  ]],
  ['王维', '裴迪', 9, '唱和', [
    ['辋川集·鹿柴', '王维', '空山不见人,但闻人语响。', '王维与裴迪各赋辋川二十景,结为《辋川集》'],
    ['赠裴十迪', '王维', '风景日夕佳,与君赋新诗。', '辋川闲居相赠'],
  ]],
  ['王昌龄', '王之涣', 6, '提及', [
    ['凉州词', '王之涣', '羌笛何须怨杨柳,春风不度玉门关。', '旗亭画壁:王昌龄、高适、王之涣听伶人唱诗竞名'],
  ]],
  ['白居易', '元稹', 10, '唱和', [
    ['梦微之', '白居易', '君埋泉下泥销骨,我寄人间雪满头。', '元稹逝后九年,白居易梦中相见而作'],
    ['同李十一醉忆元九', '白居易', '忽忆故人天际去,计程今日到梁州。', '醉中计算元稹行程,元稹果于当日梦游曲江'],
  ]],
  ['元稹', '白居易', 10, '唱和', [
    ['闻乐天授江州司马', '元稹', '垂死病中惊坐起,暗风吹雨入寒窗。', '元稹病中闻白居易贬江州'],
    ['酬乐天频梦微之', '元稹', '我今因病魂颠倒,唯梦闲人不梦君。', '酬答白居易寄梦之作'],
  ]],
  ['白居易', '刘禹锡', 9, '唱和', [
    ['醉赠刘二十八使君', '白居易', '亦知合被才名折,二十三年折太多。', '扬州初逢,白居易为刘禹锡长年贬谪抱不平'],
  ]],
  ['刘禹锡', '白居易', 9, '唱和', [
    ['酬乐天扬州初逢席上见赠', '刘禹锡', '沉舟侧畔千帆过,病树前头万木春。', '酬答白居易扬州席上所赠'],
  ]],
  ['刘禹锡', '柳宗元', 9, '悼亡', [
    ['重至衡阳伤柳仪曹', '刘禹锡', '千里江蓠春,故人今不见。', '柳宗元逝后,刘禹锡重经衡阳伤悼'],
  ]],
  ['柳宗元', '刘禹锡', 9, '送别', [
    ['衡阳与梦得分路赠别', '柳宗元', '今朝不用临河别,垂泪千行便濯缨。', '二人再贬,衡阳分路'],
  ]],
  ['白居易', '李白', 6, '悼亡', [
    ['李白墓', '白居易', '可怜荒垄穷泉骨,曾有惊天动地文。', '白居易过采石李白墓凭吊'],
  ]],
  ['元稹', '杜甫', 7, '提及', [
    ['酬李甫见赠', '元稹', '杜甫天材颇绝伦,每寻诗卷似情亲。', '元稹极推杜诗,并撰杜甫墓系铭'],
  ]],
  ['白居易', '张籍', 7, '赠诗', [
    ['读张籍古乐府', '白居易', '尤工乐府诗,举代少其伦。', '白居易推重张籍乐府'],
  ]],
  ['元稹', '李绅', 6, '唱和', [
    ['和李校书新题乐府十二首·序', '元稹', '取其病时之尤急者,列而和之。', '和李绅《新题乐府》,开新乐府唱和'],
  ]],
  ['韩愈', '孟郊', 9, '赠诗', [
    ['醉留东野', '韩愈', '吾愿身为云,东野变为龙。', '韩愈醉中留孟郊,愿相随如云龙'],
  ]],
  ['韩愈', '贾岛', 7, '提及', [
    ['题诗后', '贾岛', '两句三年得,一吟双泪流。', '"推敲"之典:贾岛冲撞韩愈车骑,韩愈为定"敲"字'],
  ]],
  ['韩愈', '李贺', 7, '提及', [
    ['高轩过', '李贺', '笔补造化天无功,庞眉书客感秋蓬。', '韩愈、皇甫湜联骑过访,李贺援笔立成此诗'],
  ]],
  ['韩愈', '柳宗元', 7, '悼亡', [
    ['祭柳子厚文', '韩愈', '嗟嗟子厚,而至然耶!', '柳宗元逝,韩愈为文哭祭并撰墓志'],
  ]],
  ['孟郊', '韩愈', 8, '唱和', [
    ['答韩愈李观别因献张徐州', '孟郊', '富别愁在颜,贫别愁销骨。', '孟郊答韩愈赠别'],
  ]],
  ['李商隐', '杜牧', 7, '赠诗', [
    ['杜司勋', '李商隐', '刻意伤春复伤别,人间惟有杜司勋。', '李商隐推重杜牧诗笔'],
  ]],
  ['李商隐', '温庭筠', 6, '唱和', [
    ['闻著明凶问哭寄飞卿', '李商隐', '昨夜西池凉露满,桂花吹断月中香。', '李商隐寄温庭筠'],
  ]],
  ['皮日休', '陆龟蒙', 9, '唱和', [
    ['奉和鲁望秋日遣怀次韵', '皮日休', '高韵最宜题雪赞,浊醪还称读离骚。', '皮陆松陵唱和,结集《松陵集》'],
  ]],
  ['陆龟蒙', '皮日休', 9, '唱和', [
    ['奉酬袭美先辈吴中苦雨一百韵', '陆龟蒙', '层云愁天低,久雨倚槛冷。', '吴中唱和百韵'],
  ]],
  ['苏轼', '苏辙', 10, '赠诗', [
    ['水调歌头·明月几时有', '苏轼', '但愿人长久,千里共婵娟。', '丙辰中秋,兼怀子由'],
    ['狱中寄子由二首·其一', '苏轼', '与君世世为兄弟,更结来生未了因。', '乌台诗案系狱,寄别苏辙'],
  ]],
  ['苏辙', '苏轼', 9, '唱和', [
    ['怀渑池寄子瞻兄', '苏辙', '相携话别郑原上,共道长途怕雪泥。', '苏轼名作《和子由渑池怀旧》即答此诗'],
  ]],
  ['苏轼', '欧阳修', 8, '悼亡', [
    ['西江月·平山堂', '苏轼', '欲吊文章太守,仍歌杨柳春风。', '过平山堂追怀恩师欧阳修'],
  ]],
  ['欧阳修', '梅尧臣', 8, '唱和', [
    ['水谷夜行寄子美圣俞', '欧阳修', '梅翁事清切,石齿漱寒濑。', '欧阳修寄苏舜钦、梅尧臣论二家诗'],
  ]],
  ['苏轼', '黄庭坚', 8, '唱和', [
    ['次韵黄鲁直见赠古风二首', '苏轼', '嘉谷卧风雨,莨莠登我场。', '黄庭坚投诗定交,苏轼次韵作答'],
  ]],
  ['黄庭坚', '苏轼', 9, '赠诗', [
    ['双井茶送子瞻', '黄庭坚', '我家江南摘云腴,落硙霏霏雪不如。', '以家乡双井茶赠苏轼'],
  ]],
  ['苏轼', '秦观', 7, '唱和', [
    ['次韵秦太虚见戏耳聋', '苏轼', '君不见诗人借车无可载,留得一钱何足赖。', '与秦观戏作唱和'],
  ]],
  ['苏轼', '王安石', 7, '唱和', [
    ['次荆公韵四绝·其三', '苏轼', '骑驴渺渺入荒陂,想见先生未病时。', '苏轼过金陵访王安石,次其韵'],
  ]],
  ['黄庭坚', '陈师道', 7, '提及', [
    ['病起荆江亭即事', '黄庭坚', '闭门觅句陈无己,对客挥毫秦少游。', '并举陈师道、秦观诗风'],
  ]],
  ['李清照', '晏殊', 4, '提及', [
    ['词论', '李清照', '晏元献、欧阳永叔、苏子瞻,学际天人,作为小歌词,直如酌蠡水于大海。', '《词论》历评北宋诸家'],
  ]],
  ['李清照', '苏轼', 4, '提及', [
    ['词论', '李清照', '苏子瞻学际天人,然皆句读不葺之诗尔。', '《词论》评苏词'],
  ]],
  ['陆游', '范成大', 8, '唱和', [
    ['送范舍人还朝', '陆游', '平生嗜酒不为味,聊欲醉中遗万事。', '陆游在蜀入范成大幕,唱和甚多'],
  ]],
  ['杨万里', '陆游', 7, '唱和', [
    ['跋陆务观剑南诗稿', '杨万里', '重寻子美行程旧,尽拾灵均怨句新。', '杨万里题陆游诗稿'],
  ]],
  ['辛弃疾', '陈亮', 9, '唱和', [
    ['贺新郎·把酒长亭说', '辛弃疾', '我最怜君中宵舞,道男儿到死心如铁。', '鹅湖之会后追赋,与陈亮往复唱和'],
  ]],
  ['陈亮', '辛弃疾', 9, '唱和', [
    ['贺新郎·寄辛幼安和见怀韵', '陈亮', '树犹如此堪重别,只使君、从来与我,话头多合。', '和辛弃疾见怀之作'],
  ]],
  ['辛弃疾', '朱熹', 7, '悼亡', [
    ['祭朱晦庵先生文', '辛弃疾', '所不朽者,垂万世名。孰谓公死,凛凛犹生。', '朱熹逝,伪学禁方严,辛弃疾往哭之'],
  ]],
  ['姜夔', '范成大', 8, '赠诗', [
    ['暗香·旧时月色', '姜夔', '旧时月色,算几番照我,梅边吹笛。', '雪中访石湖,范成大征新声,姜夔作《暗香》《疏影》'],
  ]],
  ['姜夔', '杨万里', 6, '提及', [
    ['送朝天续集归诚斋', '姜夔', '翰墨场中老斫轮,真能一笔扫千军。', '姜夔题杨万里诗集'],
  ]],
  ['陆游', '朱熹', 6, '唱和', [
    ['寄朱元晦提举', '陆游', '黄卷难求千载友,白云不负一生闲。', '与朱熹书札诗篇往还'],
  ]],
  ['刘过', '辛弃疾', 7, '赠诗', [
    ['沁园春·寄辛承旨', '刘过', '斗酒彘肩,风雨渡江,岂不快哉。', '辛弃疾招刘过,刘过以词代简'],
  ]],
  ['曹丕', '曹植', 7, '提及', [
    ['七步诗', '曹植', '本是同根生,相煎何太急。', '世说新语载曹丕命曹植七步成诗'],
  ]],
  ['曹植', '王粲', 6, '悼亡', [
    ['王仲宣诔', '曹植', '吾与夫子,义贯丹青。好和琴瑟,分过友生。', '王粲逝,曹植作诔哀悼'],
  ]],
  ['曹丕', '刘桢', 6, '提及', [
    ['与吴质书', '曹丕', '公干有逸气,但未遒耳。', '曹丕论建安诸子,追念亡友'],
  ]],
  ['嵇康', '阮籍', 7, '提及', [
    ['与山巨源绝交书', '嵇康', '阮嗣宗口不论人过,吾每师之而未能及。', '竹林之游,嵇康自言师法阮籍'],
  ]],
  ['鲍照', '谢灵运', 5, '提及', [
    ['南史·颜延之传', '鲍照', '谢五言如初发芙蓉,自然可爱。', '鲍照评谢灵运诗'],
  ]],
  ['杜甫', '曹植', 4, '提及', [
    ['别李义', '杜甫', '子建文笔壮,河间经术存。', '杜甫诗中引曹植为文章典范'],
  ]],
  ['杜甫', '陶渊明', 4, '提及', [
    ['遣兴五首·其三', '杜甫', '陶潜避俗翁,未必能达道。', '杜甫论陶渊明'],
  ]],
  ['李白', '谢灵运', 4, '提及', [
    ['梦游天姥吟留别', '李白', '脚著谢公屐,身登青云梯。', '李白梦游追蹑谢灵运游踪'],
  ]],
  ['王勃', '杨炯', 6, '提及', [
    ['旧唐书·杨炯传', '杨炯', '吾愧在卢前,耻居王后。', '"王杨卢骆"四杰并称之论'],
  ]],
  ['卢照邻', '骆宾王', 5, '唱和', [
    ['乐府杂诗序', '卢照邻', '得骆宾王之遗风,窃议其体。', '四杰文脉相承'],
  ]],
  ['贺知章', '李白', 8, '提及', [
    ['本事诗', '贺知章', '公非人世之人,可不是太白星精耶?', '贺知章读《蜀道难》,呼李白为"谪仙人"'],
  ]],
  ['张九龄', '王维', 6, '赠诗', [
    ['献始兴公', '王维', '所不卖公器,动为苍生谋。', '王维献诗张九龄,后得擢右拾遗'],
  ]],
  ['韦应物', '刘长卿', 5, '唱和', [
    ['寄别李儋', '韦应物', '首夏犹清和,芳草亦未歇。', '大历诗人江南酬唱'],
  ]],
  ['欧阳修', '晏殊', 6, '提及', [
    ['浣溪沙·一曲新词酒一杯', '晏殊', '无可奈何花落去,似曾相识燕归来。', '欧阳修出晏殊门下,词风相承'],
  ]],
  ['秦观', '黄庭坚', 6, '唱和', [
    ['千秋岁·水边沙外', '秦观', '春去也,飞红万点愁如海。', '秦观贬处州作,苏门诸人皆有和篇'],
  ]],
  ['张耒', '苏轼', 6, '提及', [
    ['祭东坡先生文', '张耒', '士之所长,气节文章。', '苏门四学士之一,苏轼逝后致祭'],
  ]],
  ['晁补之', '苏轼', 6, '唱和', [
    ['水龙吟·次韵林圣予惜春', '晁补之', '问春何苦匆匆,带风伴雨如驰骤。', '苏门四学士之一,与苏轼诗词往还'],
  ]],
  ['米芾', '苏轼', 5, '提及', [
    ['画史', '米芾', '子瞻作枯木,枝干虬屈无端。', '米芾记苏轼画竹石'],
  ]],
  ['文天祥', '杜甫', 5, '提及', [
    ['集杜诗·自序', '文天祥', '凡吾意所欲言者,子美先为代言之。', '燕狱中集杜甫诗句成二百首'],
  ]],
  ['李清照', '柳永', 3, '提及', [
    ['词论', '李清照', '柳屯田变旧声作新声,虽协音律,而词语尘下。', '《词论》评柳永'],
  ]],
  ['杨万里', '范成大', 7, '唱和', [
    ['寄题石湖先生范至能参政石湖精舍', '杨万里', '万顷湖光一片春,何须割破损天真。', '题范成大石湖精舍'],
  ]],
  ['陆游', '辛弃疾', 6, '赠诗', [
    ['送辛幼安殿撰造朝', '陆游', '大材小用古所叹,管仲萧何实流亚。', '辛弃疾赴召,八十五岁的陆游作诗送行'],
  ]],
];

// ---------------------------------------------------------------------------
// Procedural expansion
// ---------------------------------------------------------------------------
const SURNAMES = '张王李赵刘陈杨周吴徐孙朱高林何郭马罗宋谢唐韩曹许邓萧冯曾程蔡彭潘袁董余叶吕魏蒋田沈姜范江傅钟卢汪戴崔任陆廖姚方金夏谭韦贾邹石熊孟秦阎薛侯雷段郝孔邵史毛常万顾赖武康贺严尹钱施牛洪龚'.split('');
const GIVEN = '之涣清远山川湖静深云翰文若虚淮岸松柏鹤龄嗣先德明允恭士元公度仲舒季伦叔达伯言景初彦辅敬宗昂延年茂弘知微处默卿绍祖纯令问亭嘉佑昉'.split('');
const CY1 = '子文季伯仲叔公元德君景士彦孝敬永延'.split('');
const CY2 = '安和之卿甫翁然美真卿平直方远山川度'.split('');

const DYNASTY_BY_GROUP = [
  '魏晋', '唐', '唐', '唐', '唐', '唐', '唐', '唐', '北宋', '南宋',
  '汉', '南朝', '唐', '五代', '金', '元', '明', '清', '近现代',
];
const PLACES = ['江陵', '洛阳', '广陵', '吴中', '蜀中', '岭南', '塞北', '金陵', '襄阳', '长安', '杭州', '湖州', '夜郎', '柴桑'];
const LINK_TYPES = ['赠诗', '唱和', '送别', '悼亡', '提及'];

function genEvidence(type, sourceName, targetName) {
  const short = targetName.length > 1 ? targetName.slice(1) : targetName;
  const titles = {
    赠诗: [`赠${targetName}`, `寄${short}`, `投赠${targetName}`],
    唱和: [`酬${targetName}见寄`, `和${short}韵`, `次韵${targetName}见赠`],
    送别: [`送${targetName}之${pick(PLACES)}`, `送别${targetName}`, `饯${short}东游`],
    悼亡: [`哭${targetName}`, `悼${short}`, `伤${targetName}`],
    提及: [`怀${targetName}`, `忆${short}旧游`, `简${targetName}`],
  };
  const notes = {
    赠诗: '以诗相赠,情见乎辞。',
    唱和: '往复酬唱,传为一时佳话。',
    送别: '临歧赋诗,以壮行色。',
    悼亡: '故人云亡,作诗哭之。',
    提及: '诗题及之,交游可考。',
  };
  return [{
    title: pick(titles[type]),
    author: sourceName,
    content: '(示例数据:诗文内容从略)',
    relation: notes[type],
  }];
}

// Cap on total real poets (perf: each is at least one sprite). The curated
// core keeps its documented relationships; the rest are real poets pulled from
// the chinese-poetry corpus (scripts/real-poets.json) — real names, dynasties
// and poem counts, arranged into the galaxy. Only the curated relationships
// are documented; the wider link web is illustrative.
const MAX_NODES = 1600;

// real poets ingested from the open corpus (see scripts/fetch-poets.mjs)
let REAL_POETS = [];
try {
  REAL_POETS = JSON.parse(
    readFileSync(join(__dirname, 'real-poets.json'), 'utf8'),
  );
} catch {
  console.warn('real-poets.json missing — run: node scripts/fetch-poets.mjs');
}

// Spread real poets evenly across ALL arms (round-robin) so every spiral arm
// holds roughly the same number of stars — no arm ends up much thicker than
// another (#1). Arms are spatial clusters, not strict schools.
let armCursor = 0;
function nextArm() {
  const g = armCursor % GROUPS.length;
  armCursor++;
  return g;
}

const nodes = [];
const usedNames = new Set();
const idByName = new Map();

function addNode(name, courtesyName, dynasty, poemCount, group, isHub, generated) {
  const id = `p${nodes.length}`;
  nodes.push({
    id,
    name,
    courtesyName,
    dynasty,
    poemCount,
    group,
    generated,
    isHub,
    // positions assigned by the spiral-arm pass below
    x: 0,
    y: 0,
    z: 0,
  });
  usedNames.add(name);
  idByName.set(name, id);
  return id;
}

// 1) curated real poets (documented relationships, courtesy names)
for (const [name, cy, dyn, pc, group, hub] of CURATED_POETS) {
  addNode(name, cy, dyn, pc, group, hub, false);
}

// 2) fill the rest with real poets from the corpus (deduped against curated).
//    every node is now a real historical poet — no invented names.
for (const p of REAL_POETS) {
  if (nodes.length >= MAX_NODES) break;
  if (usedNames.has(p.name)) continue;
  addNode(p.name, '', p.dynasty, p.poemCount, nextArm(), false, false);
}

// --- spiral-arm position pass ----------------------------------------------
// Hubs (famous poets) sit toward the inner arm; everyone else spreads outward.
for (const g of GROUPS) {
  const members = nodes.filter((n) => n.group === g.id);
  members.sort(
    (a, b) => (b.isHub ? 1 : 0) - (a.isHub ? 1 : 0) || b.poemCount - a.poemCount,
  );
  const phi = (g.id / GROUPS.length) * Math.PI * 2;
  members.forEach((n, i) => {
    // normalized position along the arm, with jitter
    const s = Math.max(0.02, Math.min(1, (i + 0.5) / members.length + (rand() - 0.5) * 0.08));
    const r = ARM_R_CORE + s * (ARM_R_MAX - ARM_R_CORE) + gauss() * 7;
    const theta = phi + s * ARM_WIND;
    // narrow arm bands (~30% tighter): each arm stays a crisp, separate lane
    // that never blends into its neighbours; disc thickens near the bulge
    const scatter = 8 + 14 * s;
    n.x = r * Math.cos(theta) + gauss() * scatter;
    n.z = r * Math.sin(theta) + gauss() * scatter;
    // Volumetric disc: thickness tapers from the galactic centre outward, the
    // centre being ~15× thicker than the rim (thick middle → thin edges).
    const thickness = 2 + 28 * Math.exp(-r / 150); // ~30 at core, ~2 at rim
    n.y = gauss() * thickness;
  });
}
for (const n of nodes) delete n.isHub;

// --- centre the galaxy and assign each poet a stable 3D coordinate (relative
// to the galactic centre) and a unique catalogue number (#4, #5) ------------
{
  let cx = 0, cy = 0, cz = 0;
  for (const n of nodes) { cx += n.x; cy += n.y; cz += n.z; }
  cx /= nodes.length; cy /= nodes.length; cz /= nodes.length;
  nodes.forEach((n, i) => {
    n.x -= cx; n.y -= cy; n.z -= cz;
    n.coord = { x: Math.round(n.x), y: Math.round(n.y), z: Math.round(n.z) };
    n.code = `SH-${String(i + 1).padStart(4, '0')}`;
  });
}

const membersByGroup = GROUPS.map((g) =>
  nodes.filter((n) => n.group === g.id)
);
const hubNames = new Set(CURATED_POETS.filter((p) => p[5]).map((p) => p[0]));
const hubsByGroup = GROUPS.map((g) =>
  nodes.filter((n) => n.group === g.id && hubNames.has(n.name))
);

const links = [];
const linkKeys = new Set();
function addLink(sourceId, targetId, weight, type, evidence, generated) {
  if (sourceId === targetId) return false;
  const key = sourceId < targetId ? `${sourceId}|${targetId}` : `${targetId}|${sourceId}`;
  if (linkKeys.has(key)) return false;
  linkKeys.add(key);
  links.push({ source: sourceId, target: targetId, weight, type, evidence, generated });
  return true;
}

for (const [s, t, w, type, evs] of CURATED_LINKS) {
  const evidence = evs.map(([title, author, content, relation]) => ({ title, author, content, relation }));
  addLink(idByName.get(s), idByName.get(t), w, type, evidence, false);
}

// Illustrative intra-community links: every non-curated poet orbits 1–2 hubs
// and befriends a few peers in its arm (marked generated — not documented).
const GEN_TYPE_POOL = ['赠诗', '赠诗', '赠诗', '唱和', '唱和', '唱和', '送别', '送别', '提及', '提及', '悼亡'];
const curatedNames = new Set(CURATED_POETS.map((p) => p[0]));
for (const node of nodes) {
  if (curatedNames.has(node.name)) continue; // curated keep their real links
  const hubs = hubsByGroup[node.group];
  const peers = membersByGroup[node.group];
  if (peers.length < 2) continue;
  for (let i = 0; i < randInt(1, 2) && hubs.length; i++) {
    const hub = pick(hubs);
    const type = pick(GEN_TYPE_POOL);
    if (hub.id !== node.id) addLink(node.id, hub.id, randInt(3, 7), type, genEvidence(type, node.name, hub.name), true);
  }
  for (let i = 0; i < randInt(2, 4); i++) {
    const peer = pick(peers);
    const type = pick(GEN_TYPE_POOL);
    if (peer.id !== node.id) addLink(node.id, peer.id, randInt(2, 6), type, genEvidence(type, node.name, peer.name), true);
  }
}

// Sparse cross-community links (weaker, dimmer).
for (let i = 0; i < 300; i++) {
  const a = pick(nodes);
  const b = pick(nodes);
  if (a.group === b.group) continue;
  const type = pick(GEN_TYPE_POOL);
  addLink(a.id, b.id, randInt(1, 3), type, genEvidence(type, a.name, b.name), true);
}

// Top up to ~TOTAL_LINKS with more intra-community links.
const TOTAL_LINKS = nodes.length * 4;
const nonEmptyGroups = GROUPS.map((g) => g.id).filter((id) => membersByGroup[id].length >= 2);
let guard = 0;
while (links.length < TOTAL_LINKS && guard < 80000) {
  guard++;
  const group = pick(nonEmptyGroups);
  const members = membersByGroup[group];
  const a = pick(members);
  const b = pick(members);
  const type = pick(GEN_TYPE_POOL);
  addLink(a.id, b.id, randInt(2, 6), type, genEvidence(type, a.name, b.name), true);
}

const data = {
  meta: {
    title: '诗人星图',
    description: '中国古典诗人赠答唱和关系图。curated 部分为真实文献关系;generated: true 的节点与连线为演示用程序生成数据。',
    generatedAt: new Date().toISOString(),
    nodeCount: nodes.length,
    linkCount: links.length,
  },
  groups: GROUPS,
  nodes,
  links,
};

const json = JSON.stringify(data);
const outPath = join(__dirname, '..', 'public', 'graph.json');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, json);
console.log(`Wrote ${outPath}: ${nodes.length} nodes, ${links.length} links`);

// Also emit a copy importable by the bundler, used as a fallback when the app
// is opened via file:// (double-clicked dist/index.html) where fetch() fails.
const embeddedPath = join(__dirname, '..', 'src', 'data', 'graph.json');
mkdirSync(dirname(embeddedPath), { recursive: true });
writeFileSync(embeddedPath, json);
console.log(`Wrote ${embeddedPath} (embedded fallback)`);
