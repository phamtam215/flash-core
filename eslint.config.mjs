// ESLint 9 flat config. Dùng type-checked rules vì những lỗi đáng giá nhất trong code
// NestJS async (promise bị bỏ rơi, await trên giá trị không phải promise) chỉ phát hiện
// được khi linter biết kiểu — rule không type-aware sẽ bỏ qua hết.
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

const BOUNDARY_MESSAGE =
  'Import sâu vào trong module khác. Chỉ được import qua public interface (index.ts) ' +
  'của module đó — xem docs/architecture.md §Ba quy tắc cấu trúc. Nếu thứ cần dùng chưa ' +
  'được export ở index.ts, hãy export nó một cách có chủ đích (kèm interface + token nếu ' +
  'là service), đừng đi vòng.';

// Dùng `regex` chứ không dùng `group`: glob của minimatch coi `*` khớp được cả `..`, nên
// group `../*/*` sẽ chặn nhầm cả `../../config` — một import hợp lệ xuyên tầng.
const DEEP_IMPORT_INTO_MODULE = {
  // './modules/health/health.service'  ❌   nhưng './modules/health'  ✅
  regex: '(^|/)modules/[^/]+/.+',
  message: BOUNDARY_MESSAGE,
};

const DEEP_IMPORT_INTO_SIBLING_MODULE = {
  // '../health/health.service'  ❌   nhưng '../health' ✅ và '../../config' ✅
  // `[^./]` ở đầu segment thứ hai là thứ loại trừ trường hợp `../../`.
  regex: '^\\.\\./[^./][^/]*/.+',
  message: BOUNDARY_MESSAGE,
};

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'src/generated/**', '*.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      // Nuốt lỗi là điều cấm trong CLAUDE.md — bắt ở tầng linter luôn.
      'no-empty': ['error', { allowEmptyCatch: false }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/require-await': 'error',

      // Tiền tệ lưu số nguyên VND — cấm dùng `==` để so sánh cho khỏi ép kiểu ngầm.
      eqeqeq: ['error', 'always'],

      // Decorator của NestJS cần class rỗng ở nhiều chỗ (module class), nên tắt rule này.
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/unbound-method': ['error', { ignoreStatic: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],

      // RANH GIỚI MODULE — luật kiến trúc quan trọng nhất của dự án,
      // xem docs/architecture.md §Ba quy tắc cấu trúc.
      //
      // NestJS đã enforce một nửa: provider không nằm trong `exports` thì module khác
      // không inject được. Nhưng DI container chỉ chặn việc INJECT — nó không chặn được
      // `import` thẳng vào file bên trong module khác rồi tự dùng. Nửa còn lại phải do
      // linter giữ, nếu không ranh giới chỉ là quy ước và sẽ xói mòn im lặng.
      'no-restricted-imports': ['error', { patterns: [DEEP_IMPORT_INTO_MODULE] }],
    },
  },
  {
    // Trong src/modules/, `../<module-khác>/...` cũng là import sâu — nhưng chuỗi đường
    // dẫn không chứa chữ "modules" nên pattern trên không thấy. Cần luật riêng ở đây.
    // Rule bị GHI ĐÈ chứ không cộng dồn giữa các block, nên phải khai lại cả hai pattern.
    files: ['src/modules/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [DEEP_IMPORT_INTO_MODULE, DEEP_IMPORT_INTO_SIBLING_MODULE] },
      ],
    },
  },
  {
    // Test được nới: mock và fixture thường cần any/non-null assertion.
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
    },
  },
  prettierConfig,
);
