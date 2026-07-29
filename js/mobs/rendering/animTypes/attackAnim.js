/**
 * Cuubz — Attack Animations
 * Shared attack patterns: lunge (bite), slam (golem), charge (dash).
 * All transforms are applied RELATIVE to initial (reset) pose.
 */

/**
 * Lunge attack — body lunges forward, head snaps down at midpoint.
 * For wolf-like biting attacks.
 * @param {THREE.Group} group
 * @param {number} progress - 0 to 1
 */
function lungeAttack(group, progress) {
  const parts = group.userData.parts;
  const init = group.userData.initialTransforms;
  if (!parts) return;

  let bodyLunge, headSnap;
  if (progress < 0.3) {
    const p = progress / 0.3;
    bodyLunge = -p * 0.08;
    headSnap = p * 0.2;
  } else if (progress < 0.7) {
    const p = (progress - 0.3) / 0.4;
    bodyLunge = -0.08 + p * 0.2;
    headSnap = 0.2 - p * 0.4;
  } else {
    const p = (progress - 0.7) / 0.3;
    bodyLunge = 0.12 - p * 0.12;
    headSnap = -0.2 + p * 0.2;
  }

  const body = parts.body || parts.torso;
  if (body) {
    const baseZ = init && init[body.name] ? init[body.name].position.z : 0;
    body.position.z = baseZ + bodyLunge;
  }

  if (parts.head) {
    const baseX = init && init['head'] ? init['head'].rotation.x : 0;
    parts.head.rotation.x = baseX + headSnap;
  }

  if (parts.snout) {
    const baseY = init && init['snout'] ? init['snout'].position.y : 0;
    parts.snout.position.y = baseY + (progress > 0.3 && progress < 0.8 ? -0.01 : 0);
  }
}

/**
 * Slam attack — arms raise then slam down, body drops.
 * For golem-like heavy attacks.
 * @param {THREE.Group} group
 * @param {number} progress - 0 to 1
 */
function slamAttack(group, progress) {
  const parts = group.userData.parts;
  const init = group.userData.initialTransforms;
  if (!parts) return;

  let armLift, bodyDrop, headTilt;
  if (progress < 0.4) {
    const p = progress / 0.4;
    armLift = p * (-1.5);
    bodyDrop = p * 0.02;
    headTilt = p * 0.1;
  } else if (progress < 0.7) {
    const p = (progress - 0.4) / 0.3;
    armLift = -1.5 + p * 1.5;
    bodyDrop = 0.02 - p * 0.08;
    headTilt = 0.1 - p * 0.15;
  } else {
    const p = (progress - 0.7) / 0.3;
    armLift = 0;
    bodyDrop = -0.06 + p * 0.06;
    headTilt = -0.05 + p * 0.05;
  }

  if (parts.arm_L) {
    const baseX = init && init['arm_L'] ? init['arm_L'].rotation.x : 0;
    parts.arm_L.rotation.x = baseX + armLift;
  }
  if (parts.arm_R) {
    const baseX = init && init['arm_R'] ? init['arm_R'].rotation.x : 0;
    parts.arm_R.rotation.x = baseX + armLift;
  }

  const body = parts.torso || parts.body;
  if (body) {
    const baseY = init && init[body.name] ? init[body.name].position.y : 0;
    body.position.y = baseY - bodyDrop;
  }

  if (parts.head) {
    const baseX = init && init['head'] ? init['head'].rotation.x : 0;
    parts.head.rotation.x = baseX + headTilt;
  }
}

/**
 * Charge attack — brief wind-up pause, then fast forward burst.
 * For ramming or dashing attacks.
 * @param {THREE.Group} group
 * @param {number} progress - 0 to 1
 */
function chargeAttack(group, progress) {
  const parts = group.userData.parts;
  const init = group.userData.initialTransforms;
  if (!parts) return;

  let bodyLean, stretch;
  if (progress < 0.4) {
    const p = progress / 0.4;
    bodyLean = p * 0.1;
    stretch = 1 - p * 0.05;
  } else if (progress < 0.8) {
    const p = (progress - 0.4) / 0.4;
    bodyLean = 0.1 - p * 0.2;
    stretch = 0.95 + p * 0.15;
  } else {
    const p = (progress - 0.8) / 0.2;
    bodyLean = -0.1 + p * 0.1;
    stretch = 1.1 - p * 0.1;
  }

  const body = parts.body || parts.torso || parts.core;
  if (body) {
    const baseZ = init && init[body.name] ? init[body.name].position.z : 0;
    body.position.z = baseZ + bodyLean;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { lungeAttack, slamAttack, chargeAttack };
}