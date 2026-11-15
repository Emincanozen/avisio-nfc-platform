import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    /**
     * Résolution de `@avisio/core` vers la source, pas vers `dist`.
     *
     * Le paquet expose deux entrées : `development` pointe sur `src`, tout le
     * reste sur le JavaScript compilé. Vite active `development` de lui-même
     * aujourd'hui, mais s'en remettre à un défaut qui peut changer d'une
     * version à l'autre coûterait cher : les tests passeraient alors contre un
     * `dist` périmé, en vert, sans rien signaler. On modifierait le domaine et
     * la suite continuerait de valider l'ancien code.
     *
     * Le contrôle qui le prouve : supprimer `packages/core/dist` et relancer
     * `npm test`. Les 317 tests doivent passer.
     */
    conditions: ['development', 'import', 'module', 'node', 'default'],
  },
  test: {
    include: ['packages/**/test/**/*.test.ts', 'apps/**/test/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
});
