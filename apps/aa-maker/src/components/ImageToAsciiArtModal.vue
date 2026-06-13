<script setup lang="ts">
const emit = defineEmits<{
  close: [];
}>();
</script>

<template>
  <div class="confirm-modal-backdrop image-to-aa-backdrop" role="presentation" @click.self="emit('close')">
    <section class="confirm-modal image-to-aa-modal" role="dialog" aria-modal="true" aria-labelledby="image-to-aa-title" @pointerdown.stop @contextmenu.prevent.stop>
      <header class="image-to-aa-header">
        <div>
          <h2 id="image-to-aa-title">Image to AA</h2>
          <p>UI mock only. Image loading and conversion are not wired yet.</p>
        </div>
        <button type="button" aria-label="Close" @click="emit('close')">&times;</button>
      </header>

      <div class="image-to-aa-body">
        <section class="image-to-aa-stage-panel" aria-label="Preview">
          <div class="image-source-loader">
            <span class="image-source-loader-title">Drop image or click to load</span>
            <span class="image-source-loader-note">No file handling in this mock</span>
          </div>

          <div class="image-target-frame" aria-label="640 x 400 target frame">
            <div class="source-image-layer"></div>
            <div class="processed-image-layer"></div>
            <pre class="ascii-overlay-layer" aria-label="ASCII overlay">......::::::------======++++
....:::::-----=====++++***##
..::::----====++++***###%%%%
::::---===+++***###%%%%@@@@@
---===+++***###%%%@@@@@%%%%#
==+++***###%%%@@@@%%%###****
++***###%%%@@%%%###***++++=
**###%%%@@%%%###***+++====-
##%%%@@%%%###***+++====----:
%%%@@%%%###***+++====---:::.
@@%%%###***+++====---:::....
%%%###***+++====---:::......
###***+++====---:::.........
***+++====---:::............
+++====---:::..............</pre>
            <div class="image-target-frame-label">640 x 400</div>
          </div>

          <div class="image-layer-strip" aria-label="Layer preview">
            <div class="image-layer-card">
              <span>half-match-layer</span>
              <strong>8x16</strong>
            </div>
            <div class="image-layer-card image-layer-card--top">
              <span>full-match-layer</span>
              <strong>16x16</strong>
            </div>
            <div class="image-layer-card image-layer-card--merged">
              <span>Composite</span>
              <strong>80x25</strong>
            </div>
          </div>

          <div class="image-match-progress" aria-label="Matching progress mock">
            <div class="image-match-progress-header">
              <span>Matching preview</span>
              <span>Grid border shows active work</span>
            </div>
            <div class="image-progress-grid">
              <span v-for="cell in 64" :key="cell" :class="{ 'is-active': cell >= 18 && cell <= 28 }"></span>
            </div>
          </div>
        </section>

        <aside class="image-control-panel" aria-label="Controls">
          <section class="image-control-group">
            <h3>Transform</h3>
            <label class="image-control-field">
              <span>Scale</span>
              <input type="range" min="25" max="400" value="100" />
            </label>
            <label class="image-control-field">
              <span>Rotation</span>
              <input type="range" min="-180" max="180" value="0" />
            </label>
            <div class="image-control-row">
              <label class="image-control-field">
                <span>X</span>
                <input type="text" value="0" />
              </label>
              <label class="image-control-field">
                <span>Y</span>
                <input type="text" value="0" />
              </label>
            </div>
          </section>

          <section class="image-control-group">
            <h3>Processing</h3>
            <label class="image-control-field">
              <span>Contrast</span>
              <input type="range" min="0" max="200" value="100" />
            </label>
            <label class="image-check-field">
              <input type="checkbox" />
              <span>Invert</span>
            </label>
            <label class="image-control-field">
              <span>Edge Mode</span>
              <select>
                <option>Off</option>
                <option>Sobel</option>
                <option>Canny-like</option>
                <option>Laplacian</option>
              </select>
            </label>
          </section>

          <section class="image-control-group">
            <h3>Matching</h3>
            <div class="image-control-row">
              <label class="image-control-field">
                <span>Difference Threshold</span>
                <input type="text" value="18" />
              </label>
              <label class="image-control-field">
                <span>Workers</span>
                <input type="text" value="Auto" />
              </label>
            </div>
            <div class="image-layer-stack-note">
              <strong>Layer stack</strong>
              <span>Full-width matches sit above half-width fallback cells.</span>
            </div>
            <button type="button" class="image-action-button" disabled>Regenerate</button>
          </section>
        </aside>
      </div>

      <footer class="image-to-aa-actions">
        <button type="button" @click="emit('close')">Cancel</button>
        <button type="button" disabled>Apply</button>
      </footer>
    </section>
  </div>
</template>
