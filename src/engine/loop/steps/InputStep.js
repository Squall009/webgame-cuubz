/**
 * Cuubz — render-loop step 1: input (PR 18)
 *
 * `src/main.js:407–437`, verbatim. The per-frame input edge-clear (`keyboard.update()`,
 * `touch.update()`), the pointer-lock flag, and the one object the rest of the frame
 * actually consumes: the merged keyboard-OR-touch `inputState` that `PlayerStep` hands
 * to `Player.update()`.
 *
 * This runs FIRST because `keyboard.update()` / `touch.update()` roll the just-pressed
 * edges forward; `mouse.update()` deliberately does **not** run here — it is at the end
 * of `CombatStep`, after `blockInteraction` and the mob attack have read its flags.
 */

/**
 * @param {import('../../../core/GameState.js').GameState} state
 * @returns {object} the merged input state for this frame
 */
export function inputStep(state) {
  // Update keyboard just-pressed flags
  state.keyboard.update();

  // Update touch input (clears per-frame state)
  state.touch.update();

  // Update mouse pointer lock state
  if (document.pointerLockElement === state.canvas) {
    state.mouse.locked = true;
  } else {
    state.mouse.locked = false;
  }

  // Apply mouse movement to player yaw/pitch (pointer lock)
  if (state.mouse._onMouseMoveBound) {
    // Mouse movement handled via pointerlockchange event
  }

  // Build merged input state (keyboard OR touch — both can contribute)
  const jumpRaw = state.keyboard.jumpAction.held || state.touch.jump;
  const jumpDown = state.keyboard.jumpAction.down || state.touch.jumpJustPressed;
  const inputState = {
    forward: state.keyboard.forward || (state.touch.joystickY < -0.3),
    backward: state.keyboard.backward || (state.touch.joystickY > 0.3),
    left: state.keyboard.left || (state.touch.joystickX < -0.3),
    right: state.keyboard.right || (state.touch.joystickX > 0.3),
    jumpHeld: jumpRaw,
    jumpDown: jumpDown,
    sprint: state.keyboard.sprint, // No mobile sprint yet — could add a dedicated button later
    sneak: state.keyboard.sneakAction.held,
  };

  return inputState;
}
