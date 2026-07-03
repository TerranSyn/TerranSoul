#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// MILLION-RESUME-BENCH corpus generator (Phase A, 2026-07-03).
//
// Generates deterministic multilingual synthetic resumes with exact gold
// labels for the JD retrieval benchmark (see jd-million-bench.mjs). Pure,
// importable library + CLI. Never holds the corpus in RAM: the CLI streams
// resumes.jsonl / meta.jsonl line by line with write-stream backpressure.
//
// Determinism contract (BENCH-SCALE-3 resume pattern): resume N is a pure
// function of (seed, N) — independent of --count and of any previously
// generated row — so a partially-ingested store can be resumed by slicing
// the corpus at the store's `count`.
//
// CLI:
//   node benchmark/scripts/jd-corpus.mjs generate --count 1000000 --out target-copilot-bench/jdbench/ [--seed 20260703]
//   node benchmark/scripts/jd-corpus.mjs gold --out target-copilot-bench/jdbench/
//
// Outputs in --out:
//   resumes.jsonl  one {session_id, text, date, turn_count: 1} per line
//   meta.jsonl     one {id, lang, area, skills[], years, seniority} per line
//   manifest.json  {seed, count, langHistogram, areaHistogram}
//   gold.json      (from `gold`) per-JD gold id sets + per-language counts

import { createWriteStream, createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_SEED = 20260703;

// ---------------------------------------------------------------------------
// Seeded PRNG
// ---------------------------------------------------------------------------

/** mulberry32 — tiny, fast, good-enough 32-bit seeded PRNG. Returns fn -> [0,1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Per-resume PRNG: murmur3-style finalizer over (seed, index) so row N is
 * identical regardless of how many rows were generated before it.
 */
export function resumeRng(seed, index) {
  let h = seed >>> 0;
  h = Math.imul(h ^ (index + 0x9e3779b9), 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return mulberry32(h >>> 0);
}

// ---------------------------------------------------------------------------
// Taxonomy: 10 job areas, canonical skill IDs, Latin-script surface forms
// ---------------------------------------------------------------------------
// Tech-token surface forms stay in Latin script across ALL languages — that
// is realistic (CVs worldwide write "Rust", "PostgreSQL") and it is what
// makes cross-lingual lexical retrieval plausible.

export const SKILL_SURFACES = {
  'skill:python': 'Python', 'skill:java': 'Java', 'skill:nodejs': 'Node.js',
  'skill:sql': 'SQL', 'skill:rest-api': 'REST API', 'skill:docker': 'Docker',
  'skill:mysql': 'MySQL', 'skill:redis': 'Redis', 'skill:mongodb': 'MongoDB',
  'skill:graphql': 'GraphQL', 'skill:csharp': 'C#', 'skill:go': 'Go',
  'skill:rust': 'Rust', 'skill:postgresql': 'PostgreSQL', 'skill:kubernetes': 'Kubernetes',
  'skill:grpc': 'gRPC', 'skill:kafka': 'Kafka', 'skill:rabbitmq': 'RabbitMQ',
  'skill:elasticsearch': 'Elasticsearch', 'skill:microservices': 'Microservices',
  'skill:javascript': 'JavaScript', 'skill:typescript': 'TypeScript', 'skill:react': 'React',
  'skill:html': 'HTML', 'skill:css': 'CSS', 'skill:vue': 'Vue.js', 'skill:angular': 'Angular',
  'skill:webpack': 'Webpack', 'skill:sass': 'Sass', 'skill:jest': 'Jest',
  'skill:nextjs': 'Next.js', 'skill:redux': 'Redux', 'skill:svelte': 'Svelte',
  'skill:vite': 'Vite', 'skill:nuxt': 'Nuxt', 'skill:tailwind': 'Tailwind CSS',
  'skill:pinia': 'Pinia', 'skill:storybook': 'Storybook', 'skill:playwright': 'Playwright',
  'skill:accessibility': 'Accessibility (WCAG)',
  'skill:etl': 'ETL', 'skill:data-modeling': 'Data Modeling', 'skill:snowflake': 'Snowflake',
  'skill:dbt': 'dbt', 'skill:scala': 'Scala', 'skill:bigquery': 'BigQuery',
  'skill:redshift': 'Redshift', 'skill:hadoop': 'Hadoop', 'skill:hive': 'Hive',
  'skill:databricks': 'Databricks', 'skill:data-warehouse': 'Data Warehouse',
  'skill:aws-glue': 'AWS Glue', 'skill:spark': 'Spark', 'skill:airflow': 'Airflow',
  'skill:flink': 'Flink',
  'skill:pandas': 'Pandas', 'skill:numpy': 'NumPy', 'skill:scikit-learn': 'scikit-learn',
  'skill:jupyter': 'Jupyter', 'skill:matplotlib': 'Matplotlib', 'skill:pytorch': 'PyTorch',
  'skill:tensorflow': 'TensorFlow', 'skill:xgboost': 'XGBoost', 'skill:nlp': 'NLP',
  'skill:computer-vision': 'Computer Vision', 'skill:statistics': 'Statistics',
  'skill:mlops': 'MLOps', 'skill:huggingface': 'Hugging Face',
  'skill:llm-fine-tuning': 'LLM Fine-tuning', 'skill:r': 'R',
  'skill:terraform': 'Terraform', 'skill:ansible': 'Ansible', 'skill:aws': 'AWS',
  'skill:linux': 'Linux', 'skill:gcp': 'GCP', 'skill:azure': 'Azure',
  'skill:github-actions': 'GitHub Actions', 'skill:gitlab-ci': 'GitLab CI',
  'skill:prometheus': 'Prometheus', 'skill:grafana': 'Grafana', 'skill:jenkins': 'Jenkins',
  'skill:bash': 'Bash', 'skill:helm': 'Helm', 'skill:istio': 'Istio',
  'skill:nginx': 'NGINX', 'skill:vault': 'Vault', 'skill:datadog': 'Datadog',
  'skill:android-sdk': 'Android SDK', 'skill:ios-sdk': 'iOS SDK', 'skill:firebase': 'Firebase',
  'skill:gradle': 'Gradle', 'skill:flutter': 'Flutter', 'skill:dart': 'Dart',
  'skill:sqlite': 'SQLite', 'skill:xcode': 'Xcode', 'skill:jetpack-compose': 'Jetpack Compose',
  'skill:fastlane': 'Fastlane', 'skill:swift': 'Swift', 'skill:kotlin': 'Kotlin',
  'skill:react-native': 'React Native', 'skill:swiftui': 'SwiftUI',
  'skill:objective-c': 'Objective-C', 'skill:realm': 'Realm',
  'skill:siem': 'SIEM', 'skill:splunk': 'Splunk', 'skill:threat-modeling': 'Threat Modeling',
  'skill:incident-response': 'Incident Response', 'skill:iam': 'IAM', 'skill:owasp': 'OWASP',
  'skill:nmap': 'Nmap', 'skill:wireshark': 'Wireshark', 'skill:burp-suite': 'Burp Suite',
  'skill:metasploit': 'Metasploit', 'skill:oauth2': 'OAuth2', 'skill:cryptography': 'Cryptography',
  'skill:kali-linux': 'Kali Linux', 'skill:zero-trust': 'Zero Trust',
  'skill:test-automation': 'Test Automation', 'skill:selenium': 'Selenium',
  'skill:api-testing': 'API Testing', 'skill:postman': 'Postman', 'skill:jira': 'Jira',
  'skill:cypress': 'Cypress', 'skill:junit': 'JUnit', 'skill:pytest': 'pytest',
  'skill:jmeter': 'JMeter', 'skill:cucumber': 'Cucumber', 'skill:load-testing': 'Load Testing',
  'skill:appium': 'Appium', 'skill:testng': 'TestNG',
  'skill:figma': 'Figma', 'skill:prototyping': 'Prototyping', 'skill:wireframing': 'Wireframing',
  'skill:user-research': 'User Research', 'skill:design-systems': 'Design Systems',
  'skill:usability-testing': 'Usability Testing', 'skill:sketch': 'Sketch',
  'skill:adobe-xd': 'Adobe XD', 'skill:photoshop': 'Photoshop', 'skill:illustrator': 'Illustrator',
  'skill:information-architecture': 'Information Architecture',
  'skill:motion-design': 'Motion Design', 'skill:user-personas': 'User Personas',
  'skill:agile': 'Agile', 'skill:roadmapping': 'Roadmapping',
  'skill:stakeholder-management': 'Stakeholder Management', 'skill:user-stories': 'User Stories',
  'skill:scrum': 'Scrum', 'skill:kanban': 'Kanban', 'skill:ab-testing': 'A/B Testing',
  'skill:analytics': 'Analytics', 'skill:okrs': 'OKRs', 'skill:market-research': 'Market Research',
  'skill:confluence': 'Confluence', 'skill:product-discovery': 'Product Discovery',
  'skill:prioritization': 'Prioritization',
};

// Pool order = popularity rank. Sampling weight by rank: first 5 -> 10
// ("core"), next 7 -> 4 ("common"), rest -> 1 ("niche"), with explicit
// per-skill overrides below. DENSITY TUNING: the three JD requiredSkills
// sets all live in the niche tail of their area pools so each gold set
// lands in the 200-2000-per-1M band (asserted in jd-corpus.test.mjs).
export const AREA_POOLS = {
  backend: [
    'skill:python', 'skill:java', 'skill:nodejs', 'skill:sql', 'skill:rest-api',
    'skill:docker', 'skill:mysql', 'skill:redis', 'skill:mongodb', 'skill:graphql',
    'skill:csharp', 'skill:go',
    'skill:rust', 'skill:postgresql', 'skill:kubernetes', 'skill:grpc', 'skill:kafka',
    'skill:rabbitmq', 'skill:elasticsearch', 'skill:microservices',
  ],
  frontend: [
    'skill:javascript', 'skill:typescript', 'skill:react', 'skill:html', 'skill:css',
    'skill:vue', 'skill:angular', 'skill:webpack', 'skill:sass', 'skill:jest',
    'skill:nextjs', 'skill:redux',
    'skill:svelte', 'skill:vite', 'skill:nuxt', 'skill:tailwind', 'skill:pinia',
    'skill:storybook', 'skill:playwright', 'skill:accessibility',
  ],
  'data-engineering': [
    'skill:etl', 'skill:data-modeling', 'skill:snowflake', 'skill:dbt', 'skill:scala',
    'skill:bigquery', 'skill:redshift', 'skill:hadoop', 'skill:hive', 'skill:databricks',
    'skill:data-warehouse', 'skill:aws-glue',
    'skill:python', 'skill:sql', 'skill:spark', 'skill:airflow', 'skill:kafka', 'skill:flink',
  ],
  'data-science': [
    'skill:pandas', 'skill:numpy', 'skill:scikit-learn', 'skill:jupyter', 'skill:matplotlib',
    'skill:pytorch', 'skill:tensorflow', 'skill:xgboost', 'skill:nlp', 'skill:computer-vision',
    'skill:statistics', 'skill:mlops',
    'skill:python', 'skill:sql', 'skill:spark', 'skill:huggingface',
    'skill:llm-fine-tuning', 'skill:r',
  ],
  devops: [
    'skill:kubernetes', 'skill:docker', 'skill:terraform', 'skill:ansible', 'skill:aws',
    'skill:linux', 'skill:gcp', 'skill:azure', 'skill:github-actions', 'skill:gitlab-ci',
    'skill:prometheus', 'skill:grafana',
    'skill:jenkins', 'skill:bash', 'skill:helm', 'skill:istio', 'skill:nginx',
    'skill:vault', 'skill:datadog', 'skill:python',
  ],
  mobile: [
    'skill:android-sdk', 'skill:ios-sdk', 'skill:rest-api', 'skill:firebase', 'skill:gradle',
    'skill:flutter', 'skill:dart', 'skill:sqlite', 'skill:graphql', 'skill:xcode',
    'skill:jetpack-compose', 'skill:fastlane',
    'skill:swift', 'skill:kotlin', 'skill:react-native', 'skill:swiftui',
    'skill:objective-c', 'skill:realm',
  ],
  security: [
    'skill:siem', 'skill:splunk', 'skill:threat-modeling', 'skill:incident-response', 'skill:iam',
    'skill:owasp', 'skill:nmap', 'skill:wireshark', 'skill:burp-suite', 'skill:metasploit',
    'skill:oauth2', 'skill:cryptography',
    'skill:python', 'skill:linux', 'skill:kali-linux', 'skill:zero-trust',
  ],
  qa: [
    'skill:test-automation', 'skill:selenium', 'skill:api-testing', 'skill:postman', 'skill:jira',
    'skill:cypress', 'skill:playwright', 'skill:junit', 'skill:pytest', 'skill:jmeter',
    'skill:cucumber', 'skill:load-testing',
    'skill:appium', 'skill:testng', 'skill:typescript', 'skill:jenkins',
  ],
  'ux-design': [
    'skill:figma', 'skill:prototyping', 'skill:wireframing', 'skill:user-research',
    'skill:design-systems',
    'skill:usability-testing', 'skill:sketch', 'skill:adobe-xd', 'skill:accessibility',
    'skill:photoshop', 'skill:illustrator', 'skill:information-architecture',
    'skill:html', 'skill:css', 'skill:motion-design', 'skill:user-personas',
  ],
  product: [
    'skill:agile', 'skill:roadmapping', 'skill:stakeholder-management', 'skill:user-stories',
    'skill:jira',
    'skill:scrum', 'skill:kanban', 'skill:ab-testing', 'skill:analytics', 'skill:okrs',
    'skill:market-research', 'skill:confluence',
    'skill:sql', 'skill:figma', 'skill:product-discovery', 'skill:prioritization',
  ],
};

// Per-skill weight overrides inside a specific area pool (density tuning,
// calibrated empirically at a 100K sample — see jd-corpus.test.mjs). The VI
// data-engineering JD requires 4 skills, two of which (Python, SQL) recur
// across many pools; 0.8 keeps its gold set comfortably inside the
// 200-2000-per-1M band.
const WEIGHT_OVERRIDES = {
  'data-engineering': {
    'skill:python': 0.8, 'skill:sql': 0.8, 'skill:spark': 0.8, 'skill:airflow': 0.8,
  },
};

export const AREAS = Object.keys(AREA_POOLS);

function poolWeights(area) {
  const overrides = WEIGHT_OVERRIDES[area] ?? {};
  return AREA_POOLS[area].map((id, rank) => {
    if (id in overrides) return overrides[id];
    if (rank < 5) return 10;
    if (rank < 12) return 4;
    return 1;
  });
}

// Precomputed per-area weight arrays + own-pool sets (hot path at 1M rows).
const POOL_WEIGHTS = Object.fromEntries(AREAS.map(area => [area, poolWeights(area)]));
const POOL_SETS = Object.fromEntries(AREAS.map(area => [area, new Set(AREA_POOLS[area])]));

// ---------------------------------------------------------------------------
// Languages: distribution, name pools, native templates
// ---------------------------------------------------------------------------

export const LANG_WEIGHTS = [
  ['en', 0.40], ['vi', 0.15], ['ja', 0.15], ['ko', 0.08],
  ['zh', 0.08], ['es', 0.07], ['fr', 0.07],
];

// Template placeholders: {role} {years} {skillA} {skillB}
// nameOrder: how given/family compose; joiner between the two parts.
const LANGS = {
  en: {
    given: ['James', 'Mary', 'Robert', 'Patricia', 'John', 'Jennifer', 'Michael', 'Linda',
      'David', 'Elizabeth', 'William', 'Susan', 'Richard', 'Jessica', 'Joseph', 'Sarah',
      'Thomas', 'Karen', 'Daniel', 'Lisa', 'Matthew', 'Nancy', 'Anthony', 'Emily'],
    family: ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
      'Rodriguez', 'Martinez', 'Wilson', 'Anderson', 'Taylor', 'Thomas', 'Moore', 'Jackson',
      'Martin', 'Lee', 'Thompson', 'White', 'Harris', 'Clark', 'Lewis', 'Walker'],
    nameOrder: 'given-first', nameJoiner: ' ',
    roles: {
      backend: 'Backend Engineer', frontend: 'Frontend Engineer',
      'data-engineering': 'Data Engineer', 'data-science': 'Machine Learning Engineer',
      devops: 'DevOps Engineer', mobile: 'Mobile App Engineer', security: 'Security Engineer',
      qa: 'QA Engineer', 'ux-design': 'UX Designer', product: 'Product Manager',
    },
    seniority: { junior: 'Junior', mid: 'Mid-level', senior: 'Senior', lead: 'Lead' },
    title: (sen, role) => `${sen} ${role}`,
    summaries: [
      '{role} with {years} years of experience building reliable products with {skillA} and {skillB}.',
      'Results-driven {role} bringing {years} years of hands-on work across {skillA}, {skillB}, and modern engineering practice.',
      'Passionate {role} with {years} years of professional experience, specialising in {skillA} and {skillB}.',
      '{role} with a track record of {years} years delivering production systems built on {skillA} and {skillB}.',
    ],
    bullets: [
      'Designed and shipped services using {skillA} and {skillB}, improving delivery speed for the whole team.',
      'Led the migration of core workloads to {skillA}, collaborating with cross-functional partners on {skillB}.',
      'Maintained and optimised systems built on {skillA}, cutting incident volume through better use of {skillB}.',
      'Mentored teammates on {skillA} best practices while owning the {skillB} roadmap end to end.',
    ],
    education: [
      'Bachelor of Science in Computer Science, State University.',
      "Master's degree in Software Engineering, Institute of Technology.",
      'Bachelor of Engineering, Faculty of Information Technology.',
      'Diploma in Computer Engineering with honours.',
    ],
    skillsLabel: 'Skills',
  },
  vi: {
    given: ['Anh', 'Bình', 'Châu', 'Dũng', 'Duy', 'Giang', 'Hà', 'Hải', 'Hạnh', 'Hiếu',
      'Hoa', 'Hùng', 'Huy', 'Khánh', 'Lan', 'Linh', 'Long', 'Mai', 'Minh', 'Nam',
      'Ngọc', 'Nhung', 'Phong', 'Phúc', 'Quang', 'Quỳnh', 'Sơn', 'Thảo', 'Trang', 'Tuấn'],
    family: ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan', 'Vũ', 'Võ', 'Đặng',
      'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Lý', 'Đinh', 'Trịnh', 'Đoàn', 'Lâm',
      'Mai', 'Trương', 'Tạ', 'Cao'],
    nameOrder: 'family-first', nameJoiner: ' ',
    roles: {
      backend: 'Kỹ sư Backend', frontend: 'Kỹ sư Frontend',
      'data-engineering': 'Kỹ sư Dữ liệu', 'data-science': 'Kỹ sư Học máy',
      devops: 'Kỹ sư DevOps', mobile: 'Kỹ sư Ứng dụng Di động', security: 'Kỹ sư Bảo mật',
      qa: 'Kỹ sư Kiểm thử', 'ux-design': 'Nhà thiết kế UX', product: 'Quản lý Sản phẩm',
    },
    seniority: { junior: 'sơ cấp', mid: 'trung cấp', senior: 'cao cấp', lead: 'trưởng nhóm' },
    title: (sen, role) => `${role} ${sen}`,
    summaries: [
      '{role} với {years} năm kinh nghiệm xây dựng sản phẩm thực tế bằng {skillA} và {skillB}.',
      'Là {role} có {years} năm làm việc chuyên sâu với {skillA}, {skillB} và các quy trình phát triển hiện đại.',
      '{role} đam mê công nghệ, {years} năm kinh nghiệm, thế mạnh về {skillA} và {skillB}.',
      'Tôi là {role} với {years} năm kinh nghiệm triển khai hệ thống sản xuất dựa trên {skillA} và {skillB}.',
    ],
    bullets: [
      'Thiết kế và vận hành các dịch vụ sử dụng {skillA} và {skillB}, giúp nhóm bàn giao sản phẩm nhanh hơn.',
      'Dẫn dắt việc chuyển đổi hệ thống lõi sang {skillA}, phối hợp cùng các bộ phận khác trên nền {skillB}.',
      'Bảo trì và tối ưu hệ thống chạy trên {skillA}, giảm số sự cố nhờ khai thác tốt {skillB}.',
      'Hướng dẫn đồng nghiệp về {skillA} và chịu trách nhiệm lộ trình phát triển {skillB}.',
    ],
    education: [
      'Cử nhân Khoa học Máy tính, Đại học Bách Khoa.',
      'Thạc sĩ Kỹ thuật Phần mềm, Đại học Quốc gia.',
      'Kỹ sư Công nghệ Thông tin, Đại học Công nghệ.',
      'Tốt nghiệp loại giỏi ngành Kỹ thuật Máy tính.',
    ],
    skillsLabel: 'Kỹ năng',
  },
  ja: {
    given: ['陽翔', '蓮', '湊', '樹', '悠真', '大翔', '陸', '颯太', '結衣', '陽菜',
      '凛', '芽依', '葵', '紬', '咲良', '美咲', '健太', '翔太', '直樹', '拓海',
      '大輔', '香織', '恵美', '由美'],
    family: ['佐藤', '鈴木', '高橋', '田中', '伊藤', '渡辺', '山本', '中村', '小林', '加藤',
      '吉田', '山田', '佐々木', '山口', '松本', '井上', '木村', '林', '斎藤', '清水',
      '山崎', '森', '池田', '橋本'],
    nameOrder: 'family-first', nameJoiner: ' ',
    roles: {
      backend: 'バックエンドエンジニア', frontend: 'フロントエンドエンジニア',
      'data-engineering': 'データエンジニア', 'data-science': '機械学習エンジニア',
      devops: 'DevOpsエンジニア', mobile: 'モバイルアプリエンジニア',
      security: 'セキュリティエンジニア', qa: 'QAエンジニア',
      'ux-design': 'UXデザイナー', product: 'プロダクトマネージャー',
    },
    seniority: { junior: 'ジュニア', mid: 'ミドル', senior: 'シニア', lead: 'リード' },
    title: (sen, role) => `${sen}${role}`,
    summaries: [
      '{skillA}と{skillB}を用いた開発経験{years}年の{role}です。',
      '{years}年の実務経験を持つ{role}として、{skillA}や{skillB}を中心に製品開発に携わってきました。',
      '{role}として{years}年間、{skillA}と{skillB}を活用した信頼性の高いシステム構築に従事しています。',
      '{skillA}を強みとする{role}で、{years}年にわたり{skillB}を含む幅広い技術で開発を行ってきました。',
    ],
    bullets: [
      '{skillA}と{skillB}を使ったサービスの設計・運用を担当し、チームのリリース速度を改善しました。',
      '基幹システムの{skillA}への移行を主導し、{skillB}を用いた他部門との連携を推進しました。',
      '{skillA}上のシステムを保守・最適化し、{skillB}の活用により障害件数を削減しました。',
      '{skillA}のベストプラクティスを社内に展開し、{skillB}のロードマップ策定を担いました。',
    ],
    education: [
      '国立大学 情報工学部 卒業。',
      '工科大学大学院 ソフトウェア工学専攻 修了。',
      '私立大学 理工学部 情報科学科 卒業。',
      '高等専門学校 情報工学科 卒業。',
    ],
    skillsLabel: 'スキル',
  },
  ko: {
    given: ['민준', '서준', '도윤', '예준', '시우', '하준', '지호', '주원', '지우', '서연',
      '서윤', '지유', '하은', '민서', '수아', '지아', '예은', '다은', '현우', '준서',
      '지훈', '승현', '은지', '수빈'],
    family: ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임',
      '한', '오', '서', '신', '권', '황', '안', '송', '전', '홍',
      '유', '고', '문', '양'],
    nameOrder: 'family-first', nameJoiner: '',
    roles: {
      backend: '백엔드 엔지니어', frontend: '프론트엔드 엔지니어',
      'data-engineering': '데이터 엔지니어', 'data-science': '머신러닝 엔지니어',
      devops: '데브옵스 엔지니어', mobile: '모바일 앱 엔지니어', security: '보안 엔지니어',
      qa: 'QA 엔지니어', 'ux-design': 'UX 디자이너', product: '프로덕트 매니저',
    },
    seniority: { junior: '주니어', mid: '미들', senior: '시니어', lead: '리드' },
    title: (sen, role) => `${sen} ${role}`,
    summaries: [
      '{skillA}와 {skillB}로 제품을 개발해 온 {years}년 경력의 {role}입니다.',
      '{years}년의 실무 경험을 가진 {role}로서 {skillA}, {skillB} 중심의 개발을 수행했습니다.',
      '{role}로 {years}년간 {skillA}와 {skillB}를 활용한 안정적인 시스템 구축을 담당했습니다.',
      '{skillA}에 강점을 가진 {role}이며, {years}년 동안 {skillB}를 포함한 폭넓은 기술을 다뤄왔습니다.',
    ],
    bullets: [
      '{skillA}와 {skillB} 기반 서비스의 설계와 운영을 담당해 팀의 배포 속도를 개선했습니다.',
      '핵심 시스템의 {skillA} 전환을 주도하고 {skillB}를 활용해 타 부서와 협업했습니다.',
      '{skillA} 기반 시스템을 유지보수하고 {skillB}를 활용해 장애 건수를 줄였습니다.',
      '{skillA} 모범 사례를 사내에 전파하고 {skillB} 로드맵을 책임졌습니다.',
    ],
    education: [
      '국립대학교 컴퓨터공학과 졸업.',
      '공과대학원 소프트웨어공학 석사 수료.',
      '사립대학교 정보통신공학과 졸업.',
      '전문대학 컴퓨터공학 전공 졸업.',
    ],
    skillsLabel: '기술 스택',
  },
  zh: {
    given: ['伟', '芳', '娜', '敏', '静', '磊', '军', '洋', '勇', '艳',
      '杰', '涛', '明', '超', '秀英', '霞', '平', '刚', '桂英', '文',
      '辉', '建华', '玉兰', '婷'],
    family: ['王', '李', '张', '刘', '陈', '杨', '黄', '赵', '吴', '周',
      '徐', '孙', '马', '朱', '胡', '郭', '何', '林', '高', '罗',
      '郑', '梁', '谢', '宋'],
    nameOrder: 'family-first', nameJoiner: '',
    roles: {
      backend: '后端工程师', frontend: '前端工程师',
      'data-engineering': '数据工程师', 'data-science': '机器学习工程师',
      devops: 'DevOps工程师', mobile: '移动应用工程师', security: '安全工程师',
      qa: '测试工程师', 'ux-design': 'UX设计师', product: '产品经理',
    },
    seniority: { junior: '初级', mid: '中级', senior: '高级', lead: '资深' },
    title: (sen, role) => `${sen}${role}`,
    summaries: [
      '{years}年经验的{role}，擅长使用{skillA}和{skillB}构建可靠的产品。',
      '拥有{years}年实际开发经验的{role}，主要技术栈为{skillA}与{skillB}。',
      '作为{role}从业{years}年，长期使用{skillA}和{skillB}交付生产级系统。',
      '以{skillA}为核心技能的{role}，{years}年来在{skillB}等多种技术上积累了丰富经验。',
    ],
    bullets: [
      '负责基于{skillA}和{skillB}的服务设计与运维，提升了团队的交付速度。',
      '主导核心系统向{skillA}迁移，并通过{skillB}与其他团队协作。',
      '维护并优化运行在{skillA}上的系统，借助{skillB}降低了故障率。',
      '在团队内推广{skillA}最佳实践，并负责{skillB}的技术路线规划。',
    ],
    education: [
      '计算机科学与技术专业本科毕业。',
      '软件工程专业硕士研究生毕业。',
      '信息工程学院计算机系本科毕业。',
      '电子信息工程专业毕业，成绩优异。',
    ],
    skillsLabel: '技能',
  },
  es: {
    given: ['Alejandro', 'Sofía', 'Mateo', 'Valentina', 'Santiago', 'Camila', 'Sebastián',
      'Isabella', 'Diego', 'Lucía', 'Daniel', 'Martina', 'Gabriel', 'Victoria', 'Nicolás',
      'Emma', 'Samuel', 'Elena', 'Adrián', 'Paula', 'Javier', 'Carmen', 'Pablo', 'Marta'],
    family: ['García', 'Rodríguez', 'Martínez', 'Hernández', 'López', 'González', 'Pérez',
      'Sánchez', 'Ramírez', 'Torres', 'Flores', 'Rivera', 'Gómez', 'Díaz', 'Cruz', 'Morales',
      'Reyes', 'Gutiérrez', 'Ortiz', 'Chávez', 'Ruiz', 'Álvarez', 'Castillo', 'Jiménez'],
    nameOrder: 'given-first', nameJoiner: ' ',
    roles: {
      backend: 'Ingeniero de Backend', frontend: 'Ingeniero de Frontend',
      'data-engineering': 'Ingeniero de Datos',
      'data-science': 'Ingeniero de Aprendizaje Automático',
      devops: 'Ingeniero DevOps', mobile: 'Ingeniero de Aplicaciones Móviles',
      security: 'Ingeniero de Seguridad', qa: 'Ingeniero de QA',
      'ux-design': 'Diseñador de UX', product: 'Gerente de Producto',
    },
    seniority: { junior: 'junior', mid: 'semi senior', senior: 'sénior', lead: 'líder' },
    title: (sen, role) => `${role} ${sen}`,
    summaries: [
      '{role} con {years} años de experiencia construyendo productos fiables con {skillA} y {skillB}.',
      '{role} orientado a resultados con {years} años de trabajo práctico en {skillA} y {skillB}.',
      'Apasionado {role} con {years} años de experiencia profesional, especializado en {skillA} y {skillB}.',
      '{role} con una trayectoria de {years} años entregando sistemas en producción basados en {skillA} y {skillB}.',
    ],
    bullets: [
      'Diseñé y mantuve servicios usando {skillA} y {skillB}, mejorando la velocidad de entrega del equipo.',
      'Lideré la migración de cargas de trabajo críticas a {skillA}, colaborando con otros equipos sobre {skillB}.',
      'Mantuve y optimicé sistemas construidos sobre {skillA}, reduciendo incidentes gracias a {skillB}.',
      'Formé a mis compañeros en buenas prácticas de {skillA} y fui responsable de la hoja de ruta de {skillB}.',
    ],
    education: [
      'Grado en Ingeniería Informática, Universidad Politécnica.',
      'Máster en Ingeniería de Software, Universidad Nacional.',
      'Ingeniería en Sistemas Computacionales, Instituto Tecnológico.',
      'Técnico superior en Desarrollo de Aplicaciones.',
    ],
    skillsLabel: 'Habilidades',
  },
  fr: {
    given: ['Louis', 'Emma', 'Gabriel', 'Jade', 'Raphaël', 'Louise', 'Léo', 'Alice',
      'Lucas', 'Chloé', 'Adam', 'Lina', 'Hugo', 'Léa', 'Jules', 'Rose',
      'Arthur', 'Anna', 'Nathan', 'Inès', 'Théo', 'Camille', 'Paul', 'Juliette'],
    family: ['Martin', 'Bernard', 'Thomas', 'Petit', 'Robert', 'Richard', 'Durand', 'Dubois',
      'Moreau', 'Laurent', 'Simon', 'Michel', 'Lefebvre', 'Leroy', 'Roux', 'David',
      'Bertrand', 'Morel', 'Fournier', 'Girard', 'Bonnet', 'Dupont', 'Lambert', 'Fontaine'],
    nameOrder: 'given-first', nameJoiner: ' ',
    roles: {
      backend: 'Ingénieur Backend', frontend: 'Ingénieur Frontend',
      'data-engineering': 'Ingénieur Data',
      'data-science': 'Ingénieur en Apprentissage Automatique',
      devops: 'Ingénieur DevOps', mobile: "Ingénieur d'Applications Mobiles",
      security: 'Ingénieur Sécurité', qa: 'Ingénieur QA',
      'ux-design': 'Designer UX', product: 'Chef de Produit',
    },
    seniority: { junior: 'junior', mid: 'confirmé', senior: 'sénior', lead: 'principal' },
    title: (sen, role) => `${role} ${sen}`,
    summaries: [
      "{role} avec {years} ans d'expérience dans la création de produits fiables avec {skillA} et {skillB}.",
      '{role} orienté résultats, fort de {years} ans de pratique sur {skillA} et {skillB}.',
      "{role} passionné avec {years} ans d'expérience professionnelle, spécialisé en {skillA} et {skillB}.",
      '{role} justifiant de {years} ans de livraison de systèmes en production fondés sur {skillA} et {skillB}.',
    ],
    bullets: [
      "Conception et exploitation de services utilisant {skillA} et {skillB}, améliorant la vitesse de livraison de l'équipe.",
      "Pilotage de la migration des charges critiques vers {skillA}, en collaboration avec d'autres équipes autour de {skillB}.",
      'Maintenance et optimisation de systèmes reposant sur {skillA}, réduisant les incidents grâce à {skillB}.',
      'Formation des collègues aux bonnes pratiques {skillA} et responsabilité de la feuille de route {skillB}.',
    ],
    education: [
      "Diplôme d'ingénieur en informatique, École Polytechnique régionale.",
      'Master en génie logiciel, Université de Technologie.',
      'Licence en informatique, Université des Sciences.',
      'BTS Services informatiques aux organisations.',
    ],
    skillsLabel: 'Compétences',
  },
};

export const LANG_IDS = LANG_WEIGHTS.map(([lang]) => lang);

// ---------------------------------------------------------------------------
// Resume construction
// ---------------------------------------------------------------------------

const DATE_BASE_MS = Date.UTC(2024, 0, 1);
const DATE_SPAN_DAYS = 1096; // 2024-01-01 .. 2026-12-31 inclusive
export const TEXT_MIN = 400;
export const TEXT_MAX = 900;

function pickLang(r) {
  let acc = 0;
  for (const [lang, w] of LANG_WEIGHTS) {
    acc += w;
    if (r < acc) return lang;
  }
  return LANG_WEIGHTS[LANG_WEIGHTS.length - 1][0];
}

export function seniorityForYears(years) {
  if (years <= 2) return 'junior';
  if (years <= 5) return 'mid';
  if (years <= 10) return 'senior';
  return 'lead';
}

export const SENIORITY_RANK = { junior: 0, mid: 1, senior: 2, lead: 3 };

/** Weighted sample without replacement; consumes one rng() per pick. */
function weightedSample(rng, items, weights, k) {
  const cand = items.slice();
  const w = weights.slice();
  let total = 0;
  for (const x of w) total += x;
  const picked = [];
  for (let n = 0; n < k && cand.length > 0; n += 1) {
    let x = rng() * total;
    let i = 0;
    while (i < cand.length - 1 && x >= w[i]) {
      x -= w[i];
      i += 1;
    }
    picked.push(cand[i]);
    total -= w[i];
    cand.splice(i, 1);
    w.splice(i, 1);
  }
  return picked;
}

function interpolate(template, vars) {
  return template.replace(/\{(role|years|skillA|skillB)\}/g, (_, key) => String(vars[key]));
}

/**
 * Build resume N deterministically from (seed, index).
 *
 * Draw order is part of the determinism contract: all meta fields (lang,
 * area, years, skills, date) are drawn BEFORE any text-only draw, so
 * `metaOnly: true` can stop early and still agree byte-for-byte with the
 * meta a full generation writes.
 */
export function buildResume(index, seed = DEFAULT_SEED, { metaOnly = false } = {}) {
  const rng = resumeRng(seed, index);
  const id = `res-${index}`;

  // --- meta draws -----------------------------------------------------
  const lang = pickLang(rng());
  const area = AREAS[Math.floor(rng() * AREAS.length)];
  const years = 1 + Math.floor(rng() * 15); // 1..15
  const seniority = seniorityForYears(years);

  const nSkills = 4 + Math.floor(rng() * 5); // 4..8
  const nDistract = 1 + (rng() < 0.5 ? 1 : 0); // 1..2
  const nOwn = nSkills - nDistract; // 2..7

  const ownSkills = weightedSample(rng, AREA_POOLS[area], POOL_WEIGHTS[area], nOwn);
  const ownSet = POOL_SETS[area];
  const pickedSet = new Set(ownSkills);
  const distractors = [];
  for (let d = 0; d < nDistract; d += 1) {
    // Cross-area distractor: drawn from another area's pool EXCLUDING any
    // skill that also lives in this resume's own-area pool. Keeps the gold
    // predicate's per-JD density governed solely by the own-pool weights.
    const otherAreas = AREAS.filter(a => a !== area);
    const other = otherAreas[Math.floor(rng() * otherAreas.length)];
    const candIdx = [];
    AREA_POOLS[other].forEach((sid, i) => {
      if (!ownSet.has(sid) && !pickedSet.has(sid)) candIdx.push(i);
    });
    if (candIdx.length === 0) continue;
    const cands = candIdx.map(i => AREA_POOLS[other][i]);
    const weights = candIdx.map(i => POOL_WEIGHTS[other][i]);
    const [pick] = weightedSample(rng, cands, weights, 1);
    if (pick) {
      distractors.push(pick);
      pickedSet.add(pick);
    }
  }
  const skills = [...ownSkills, ...distractors];

  const dayOffset = Math.floor(rng() * DATE_SPAN_DAYS);
  const date = new Date(DATE_BASE_MS + dayOffset * 86400000).toISOString().slice(0, 10);

  const meta = { id, lang, area, skills, years, seniority };
  if (metaOnly) return { meta };

  // --- text draws -----------------------------------------------------
  const pack = LANGS[lang];
  const given = pack.given[Math.floor(rng() * pack.given.length)];
  const family = pack.family[Math.floor(rng() * pack.family.length)];
  const name = pack.nameOrder === 'family-first'
    ? `${family}${pack.nameJoiner}${given}`
    : `${given}${pack.nameJoiner}${family}`;

  const role = pack.roles[area];
  const title = pack.title(pack.seniority[seniority], role);
  const surfaces = skills.map(sid => SKILL_SURFACES[sid]);
  const pair = i => {
    const a = surfaces[(2 * i) % surfaces.length];
    let b = surfaces[(2 * i + 1) % surfaces.length];
    if (b === a) b = surfaces[(2 * i + 2) % surfaces.length];
    return { skillA: a, skillB: b };
  };

  const summary = interpolate(
    pack.summaries[Math.floor(rng() * pack.summaries.length)],
    { role, years, ...pair(0) },
  );
  const bulletStart = Math.floor(rng() * pack.bullets.length);
  const education = pack.education[Math.floor(rng() * pack.education.length)];
  const skillsLine = `${pack.skillsLabel}: ${surfaces.join(', ')}`;

  const bullet = i => `- ${interpolate(
    pack.bullets[(bulletStart + i) % pack.bullets.length],
    { role, years, ...pair(i + 1) },
  )}`;

  // Assemble: pad with additional experience bullets until >= TEXT_MIN.
  // Base sections are short enough in every language that padding from
  // below TEXT_MIN can never overshoot TEXT_MAX (bullets are <= ~130 chars).
  const bullets = [bullet(0), bullet(1)];
  const assemble = () => [name, title, summary, ...bullets, education, skillsLine].join('\n');
  let text = assemble();
  let extra = 2;
  while (text.length < TEXT_MIN && extra < 14) {
    bullets.push(bullet(extra));
    extra += 1;
    text = assemble();
  }

  return {
    meta,
    session: { session_id: id, text, date, turn_count: 1 },
  };
}

// ---------------------------------------------------------------------------
// Gold predicate
// ---------------------------------------------------------------------------

/**
 * Gold predicate: a resume matches a JD when the area is equal AND at least
 * 2 of the JD's requiredSkills are present AND years >= minYears (AND, when
 * the JD sets it, seniority >= seniorityAtLeast).
 */
export function matchesJd(meta, jd) {
  if (meta.area !== jd.area) return false;
  let present = 0;
  for (const sid of jd.requiredSkills) {
    if (meta.skills.includes(sid)) present += 1;
  }
  if (present < 2) return false;
  if (meta.years < jd.minYears) return false;
  if (jd.seniorityAtLeast != null
    && SENIORITY_RANK[meta.seniority] < SENIORITY_RANK[jd.seniorityAtLeast]) {
    return false;
  }
  return true;
}

/**
 * Stream meta.jsonl and compute gold id sets per JD.
 * Returns { counts, gold, byLang, langOf } where langOf maps every gold id
 * to its language (for per-language hit attribution in reports).
 */
export async function computeGold(jdList, metaPath, { onProgress } = {}) {
  const counts = Object.fromEntries(jdList.map(jd => [jd.id, 0]));
  const gold = Object.fromEntries(jdList.map(jd => [jd.id, []]));
  const byLang = Object.fromEntries(jdList.map(jd => [jd.id, {}]));
  const langOf = {};
  const rl = createInterface({ input: createReadStream(metaPath, 'utf8'), crlfDelay: Infinity });
  let lines = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    const meta = JSON.parse(line);
    lines += 1;
    for (const jd of jdList) {
      if (matchesJd(meta, jd)) {
        counts[jd.id] += 1;
        gold[jd.id].push(meta.id);
        byLang[jd.id][meta.lang] = (byLang[jd.id][meta.lang] ?? 0) + 1;
        langOf[meta.id] = meta.lang;
      }
    }
    if (onProgress && lines % 100000 === 0) onProgress(lines);
  }
  return { scanned: lines, counts, gold, byLang, langOf };
}

// ---------------------------------------------------------------------------
// Streaming corpus generation
// ---------------------------------------------------------------------------

async function writeLine(stream, line) {
  if (!stream.write(line)) await once(stream, 'drain');
}

/**
 * Stream `count` resumes to outDir/resumes.jsonl + outDir/meta.jsonl and
 * write outDir/manifest.json. Never holds the corpus in RAM.
 */
export async function generateCorpus({ count, outDir, seed = DEFAULT_SEED, onProgress }) {
  mkdirSync(outDir, { recursive: true });
  const resumesPath = resolve(outDir, 'resumes.jsonl');
  const metaPath = resolve(outDir, 'meta.jsonl');
  const manifestPath = resolve(outDir, 'manifest.json');
  const resumesOut = createWriteStream(resumesPath, 'utf8');
  const metaOut = createWriteStream(metaPath, 'utf8');

  const langHistogram = {};
  const areaHistogram = {};
  const started = Date.now();
  for (let i = 0; i < count; i += 1) {
    const { meta, session } = buildResume(i, seed);
    langHistogram[meta.lang] = (langHistogram[meta.lang] ?? 0) + 1;
    areaHistogram[meta.area] = (areaHistogram[meta.area] ?? 0) + 1;
    await writeLine(resumesOut, `${JSON.stringify(session)}\n`);
    await writeLine(metaOut, `${JSON.stringify(meta)}\n`);
    if (onProgress && (i + 1) % 100000 === 0) onProgress(i + 1, count);
  }
  await Promise.all([
    new Promise((res, rej) => resumesOut.end(err => (err ? rej(err) : res()))),
    new Promise((res, rej) => metaOut.end(err => (err ? rej(err) : res()))),
  ]);

  const manifest = {
    benchmark: 'jd-million',
    seed,
    count,
    generatedAt: new Date().toISOString(),
    elapsedSeconds: (Date.now() - started) / 1000,
    langHistogram,
    areaHistogram,
    files: { resumes: 'resumes.jsonl', meta: 'meta.jsonl' },
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { manifest, resumesPath, metaPath, manifestPath };
}

/** Compute + persist gold.json for outDir's meta.jsonl against jdList. */
export async function writeGold(jdList, outDir, { onProgress } = {}) {
  const metaPath = resolve(outDir, 'meta.jsonl');
  if (!existsSync(metaPath)) throw new Error(`missing meta.jsonl: ${metaPath}`);
  const result = await computeGold(jdList, metaPath, { onProgress });
  const goldPath = resolve(outDir, 'gold.json');
  const payload = {
    benchmark: 'jd-million',
    scanned: result.scanned,
    jds: jdList.map(jd => ({
      id: jd.id,
      lang: jd.lang,
      title: jd.title,
      area: jd.area,
      requiredSkills: jd.requiredSkills,
      minYears: jd.minYears,
      goldSize: result.counts[jd.id],
      byLang: result.byLang[jd.id],
    })),
    gold: result.gold,
    langOf: result.langOf,
  };
  writeFileSync(goldPath, `${JSON.stringify(payload)}\n`, 'utf8');
  return { ...result, goldPath };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function cliOption(argv, name, defaultValue) {
  // Supports both `--name value` and `--name=value`.
  const eq = argv.find(a => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith('--')) return argv[i + 1];
  return defaultValue;
}

async function cliMain() {
  const [, , cmd, ...argv] = process.argv;
  const outDir = resolve(process.cwd(), cliOption(argv, 'out', 'target-copilot-bench/jdbench'));
  const seed = Number(cliOption(argv, 'seed', String(DEFAULT_SEED)));
  if (!Number.isInteger(seed)) throw new Error('--seed must be an integer');

  if (cmd === 'generate') {
    const count = Number(cliOption(argv, 'count', '1000000'));
    if (!Number.isInteger(count) || count <= 0) throw new Error('--count must be a positive integer');
    console.log(`[jd-corpus] generating ${count.toLocaleString('en-US')} resumes (seed=${seed}) -> ${outDir}`);
    const { manifest } = await generateCorpus({
      count,
      outDir,
      seed,
      onProgress: (done, total) => console.log(`[jd-corpus] ${done.toLocaleString('en-US')}/${total.toLocaleString('en-US')}`),
    });
    console.log(`[jd-corpus] done in ${manifest.elapsedSeconds.toFixed(1)}s`);
    console.log(`[jd-corpus] langHistogram=${JSON.stringify(manifest.langHistogram)}`);
    console.log(`[jd-corpus] areaHistogram=${JSON.stringify(manifest.areaHistogram)}`);
    return;
  }

  if (cmd === 'gold') {
    const { JD_QUERIES } = await import('./jd-queries.mjs');
    const result = await writeGold(JD_QUERIES, outDir, {
      onProgress: n => console.log(`[jd-corpus] gold scan ${n.toLocaleString('en-US')} rows`),
    });
    console.log(`[jd-corpus] scanned ${result.scanned.toLocaleString('en-US')} meta rows`);
    for (const [jdId, n] of Object.entries(result.counts)) {
      console.log(`[jd-corpus] gold ${jdId}: ${n} (byLang=${JSON.stringify(result.byLang[jdId])})`);
    }
    console.log(`[jd-corpus] wrote ${result.goldPath}`);
    return;
  }

  console.log(`jd-corpus — deterministic multilingual synthetic resume generator

Usage:
  node benchmark/scripts/jd-corpus.mjs generate --count 1000000 --out target-copilot-bench/jdbench/ [--seed ${DEFAULT_SEED}]
  node benchmark/scripts/jd-corpus.mjs gold --out target-copilot-bench/jdbench/
`);
}

const isCli = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  cliMain().catch(err => {
    console.error(`[jd-corpus] failed: ${err.message}`);
    process.exit(1);
  });
}
