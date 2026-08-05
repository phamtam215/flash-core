// ESLint 9 flat config. Dùng type-checked rules vì những lỗi đáng giá nhất trong code
// NestJS async (promise bị bỏ rơi, await trên giá trị không phải promise) chỉ phát hiện
// được khi linter biết kiểu — rule không type-aware sẽ bỏ qua hết.
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

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
