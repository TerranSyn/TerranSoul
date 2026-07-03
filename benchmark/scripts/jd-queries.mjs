// SPDX-License-Identifier: MIT
//
// MILLION-RESUME-BENCH: the three fixed job-description queries.
//
// One JD per query language (en / vi / ja), each a DIFFERENT position, each
// with a realistic 2-4 sentence job description written natively in that
// language. Skill tokens stay in Latin script (matching the corpus surface
// forms — that is what makes cross-lingual lexical retrieval plausible).
//
// Gold predicate per JD (see jd-corpus.mjs matchesJd): area equal AND >= 2
// requiredSkills present AND years >= minYears. The requiredSkills sets are
// deliberately placed in the niche tail of their area pools so each JD's
// gold set lands in the 200-2000-per-1M band (asserted in
// benchmark/scripts/lib/jd-corpus.test.mjs).

export const JD_QUERIES = [
  {
    id: 'jd-en-backend',
    lang: 'en',
    title: 'Senior Backend Engineer',
    area: 'backend',
    requiredSkills: ['skill:rust', 'skill:postgresql', 'skill:kubernetes', 'skill:grpc'],
    minYears: 5,
    queryText: 'We are hiring a Senior Backend Engineer to own our core platform services. '
      + 'You will design and operate distributed systems written in Rust, expose gRPC APIs to '
      + 'internal teams, and run everything on Kubernetes with PostgreSQL as the system of '
      + 'record. At least 5 years of professional backend experience is required, and you '
      + 'should be comfortable debugging production incidents end to end.',
  },
  {
    id: 'jd-vi-data-engineering',
    lang: 'vi',
    title: 'Kỹ sư Dữ liệu',
    area: 'data-engineering',
    requiredSkills: ['skill:python', 'skill:spark', 'skill:airflow', 'skill:sql'],
    minYears: 3,
    queryText: 'Chúng tôi đang tìm kiếm Kỹ sư Dữ liệu để xây dựng nền tảng dữ liệu của công ty. '
      + 'Bạn sẽ phát triển các pipeline ETL bằng Python và Spark, điều phối luồng công việc với '
      + 'Airflow, đồng thời tối ưu các truy vấn SQL trên kho dữ liệu lớn. Yêu cầu tối thiểu 3 năm '
      + 'kinh nghiệm vận hành hệ thống dữ liệu trong môi trường sản xuất.',
  },
  {
    id: 'jd-ja-mobile',
    lang: 'ja',
    title: 'モバイルアプリエンジニア',
    area: 'mobile',
    requiredSkills: ['skill:swift', 'skill:kotlin', 'skill:react-native'],
    minYears: 3,
    queryText: 'モバイルアプリエンジニアを募集しています。SwiftによるiOSアプリと'
      + 'KotlinによるAndroidアプリの開発に加え、React Nativeを用いたクロスプラットフォーム'
      + '開発も担当していただきます。ユーザー体験を重視し、デザイナーと密に連携できる方を'
      + '求めています。モバイルアプリ開発の実務経験3年以上の方を歓迎します。',
  },
];

export default JD_QUERIES;
