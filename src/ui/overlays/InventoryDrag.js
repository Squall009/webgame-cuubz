/**
 * Cuubz — inventory drag-and-drop (PR 17)
 *
 * Three `document`-level listeners implementing the full drag lifecycle:
 * `mousedown` → `mousemove` (start the drag, build the ghost) → `mouseup` (drop, or
 * treat it as a click if the pointer moved 5 px or less).
 *
 * They are `document`-level and not slot-level because a drag has to be tracked after
 * the pointer leaves the slot it started on. Every one guards on
 * `state.inventoryOpen`, so they are inert while the game is being played.
 *
 * **D-50 — CLOSED IN PR 18.** They used to be added on every `startGame()` and never
 * removed, so exiting to the menu and starting again registered a second set closing
 * over the *previous* `GameState` — whose `inventoryOpen` stays `false`, which was the
 * only reason it was harmless. Each is a named `const` now (a named *function
 * expression* is not enough: the name is only bound inside its own body, so
 * `removeEventListener` had nothing to name) and each registers its remover through
 * `state.addTeardown()`, drained by `Game.stop()`.
 */

/**
 * @param {import('../../core/GameState.js').GameState} state
 */
export function installInventoryDrag(state) {
  let _invDrag = null;       // { fromSlot, fromEquipSlot, typeId, count, ghostEl }
  let _invClickStart = null; // { slot | equipSlot, x, y } — click vs drag

  const invMouseDown = function(e) {
    if (!state.inventoryOpen || e.button !== 0) return;
    const slotEl = e.target.closest('.inventory-slot');
    const equipEl = e.target.closest('.equipment-slot');
    if (slotEl) {
      e.preventDefault();
      _invClickStart = { slot: parseInt(slotEl.dataset.slot), x: e.clientX, y: e.clientY };
    } else if (equipEl) {
      e.preventDefault();
      _invClickStart = { equipSlot: equipEl.dataset.slot, x: e.clientX, y: e.clientY };
    }
  };
  document.addEventListener('mousedown', invMouseDown);
  state.addTeardown(() => document.removeEventListener('mousedown', invMouseDown));

  const invMouseMove = function(e) {
    if (!_invClickStart) return;
    const inventory = state.inventory;
    const dx = e.clientX - _invClickStart.x;
    const dy = e.clientY - _invClickStart.y;
    if (Math.sqrt(dx * dx + dy * dy) <= 5) return;

    // Start drag
    if (!_invDrag) {
      let typeId = null;
      let count = 0;
      let fromSlot = null;
      let fromEquipSlot = null;

      if (_invClickStart.slot !== undefined) {
        // Dragging from inventory slot
        const slot = inventory.getSlot(_invClickStart.slot);
        if (slot) {
          fromSlot = _invClickStart.slot;
          typeId = slot.typeId;
          count = slot.count;
          inventory.setSlot(fromSlot, null);
        }
      } else if (_invClickStart.equipSlot) {
        // Dragging from equipment slot
        const item = inventory.getEquippedItem(_invClickStart.equipSlot);
        if (item) {
          fromEquipSlot = _invClickStart.equipSlot;
          typeId = item.typeId;
          count = item.count;
          inventory.unequipItem(fromEquipSlot);
        }
      }

      if (typeId) {
        _invDrag = { fromSlot, fromEquipSlot, typeId, count };
        state.renderInventoryCraftingUI();
        state.updateHotbarUI();

        // Create drag ghost
        const ghost = document.createElement('div');
        ghost.style.cssText = 'position:fixed;pointer-events:none;z-index:10000;width:48px;height:48px;margin:-24px 0 0 -24px;';
        const canvas = document.createElement('canvas');
        canvas.width = 48; canvas.height = 48;
        canvas.style.cssText = 'width:40px;height:40px;image-rendering:pixelated;';
        state.renderItemIcon(canvas, typeId);
        ghost.appendChild(canvas);
        document.body.appendChild(ghost);
        _invDrag.ghostEl = ghost;
      }
    }
    if (_invDrag && _invDrag.ghostEl) {
      _invDrag.ghostEl.style.left = e.clientX + 'px';
      _invDrag.ghostEl.style.top = e.clientY + 'px';
    }
  };
  document.addEventListener('mousemove', invMouseMove);
  state.addTeardown(() => document.removeEventListener('mousemove', invMouseMove));

  const invMouseUp = function(e) {
    if (!_invClickStart) return;
    const inventory = state.inventory;
    const dx = e.clientX - _invClickStart.x;
    const dy = e.clientY - _invClickStart.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const fromIdx = _invClickStart.slot;
    // **D-52 — CLOSED IN PR 26.** This line is the whole fix. Only `.slot` was captured
    // before `_invClickStart` was nulled on the next line, so the equipment-slot click
    // branch 112 lines below read `_invClickStart.equipSlot` off `null`. Its guard was
    // `if (_invClickStart && …)`, so it never threw — it just never ran.
    const fromEquip = _invClickStart.equipSlot;
    _invClickStart = null;

    // ── Drag drop ──
    if (_invDrag) {
      if (_invDrag.ghostEl) _invDrag.ghostEl.remove();
      const targetEl = document.elementFromPoint(e.clientX, e.clientY);
      const slotEl = targetEl ? targetEl.closest('.inventory-slot') : null;
      const equipEl = targetEl ? targetEl.closest('.equipment-slot') : null;

      // ── Dropped on equipment slot ──
      if (equipEl) {
        const equipSlotName = equipEl.dataset.slot;

        if (inventory.isEquippable(_invDrag.typeId) && inventory.getEquipmentSlot(_invDrag.typeId) === equipSlotName) {
          // Equip the item — if slot was occupied, return old item to inventory
          const oldItem = inventory.equipItem(equipSlotName, _invDrag.typeId);
          if (oldItem) {
            // Try to add old item to inventory; if full, drop it
            const result = inventory.addItem(oldItem.typeId, oldItem.count);
            if (result.remaining > 0) {
              // Inventory full — put old item back in equipment slot
              inventory.equipItem(equipSlotName, oldItem.typeId);
              // Restore dragged item to its origin
              if (_invDrag.fromSlot !== undefined && _invDrag.fromSlot !== null) {
                inventory.setSlot(_invDrag.fromSlot, { typeId: _invDrag.typeId, count: _invDrag.count });
              } else if (_invDrag.fromEquipSlot) {
                inventory.equipItem(_invDrag.fromEquipSlot, _invDrag.typeId);
              }
            }
          }
        } else {
          // Can't equip this item — restore to origin
          if (_invDrag.fromSlot !== undefined && _invDrag.fromSlot !== null) {
            inventory.setSlot(_invDrag.fromSlot, { typeId: _invDrag.typeId, count: _invDrag.count });
          } else if (_invDrag.fromEquipSlot) {
            inventory.equipItem(_invDrag.fromEquipSlot, _invDrag.typeId);
          }
        }
      } else if (slotEl) {
        // ── Dropped on inventory slot ──
        const toIdx = parseInt(slotEl.dataset.slot);
        const toSlot = inventory.getSlot(toIdx);

        // If dragging from equipment slot, just place into inventory
        if (_invDrag.fromEquipSlot) {
          if (!toSlot) {
            // Empty slot — place the item
            inventory.setSlot(toIdx, { typeId: _invDrag.typeId, count: _invDrag.count });
          } else if (inventory.itemsMatch(toSlot.typeId, _invDrag.typeId)) {
            // Same type — try to stack
            const maxStack = inventory.getMaxStack(_invDrag.typeId);
            const space = maxStack - toSlot.count;
            if (space > 0) {
              const move = Math.min(space, _invDrag.count);
              toSlot.count += move;
              if (_invDrag.count - move > 0) {
                inventory.addItem(_invDrag.typeId, _invDrag.count - move);
              }
            } else {
              // No space — put the dragged item elsewhere, keep the slotted item
              inventory.addItem(_invDrag.typeId, _invDrag.count);
            }
          } else {
            // Different type — swap: place dragged item, move slotted item elsewhere
            inventory.setSlot(toIdx, { typeId: _invDrag.typeId, count: _invDrag.count });
            inventory.addItem(toSlot.typeId, toSlot.count);
          }
        } else if (toIdx === _invDrag.fromSlot) {
          inventory.setSlot(toIdx, { typeId: _invDrag.typeId, count: _invDrag.count });
        } else if (!toSlot) {
          inventory.setSlot(toIdx, { typeId: _invDrag.typeId, count: _invDrag.count });
        } else if (inventory.itemsMatch(toSlot.typeId, _invDrag.typeId)) {
          const maxStack = inventory.getMaxStack(_invDrag.typeId);
          const space = maxStack - toSlot.count;
          if (space > 0) {
            const move = Math.min(space, _invDrag.count);
            toSlot.count += move;
            if (_invDrag.count - move > 0) {
              inventory.setSlot(_invDrag.fromSlot, { typeId: _invDrag.typeId, count: _invDrag.count - move });
            }
          } else {
            inventory.setSlot(_invDrag.fromSlot, { typeId: toSlot.typeId, count: toSlot.count });
            inventory.setSlot(toIdx, { typeId: _invDrag.typeId, count: _invDrag.count });
          }
        } else {
          inventory.setSlot(_invDrag.fromSlot, { typeId: toSlot.typeId, count: toSlot.count });
          inventory.setSlot(toIdx, { typeId: _invDrag.typeId, count: _invDrag.count });
        }
      } else {
        // Dropped outside — restore to origin
        if (_invDrag.fromSlot !== undefined && _invDrag.fromSlot !== null) {
          inventory.setSlot(_invDrag.fromSlot, { typeId: _invDrag.typeId, count: _invDrag.count });
        } else if (_invDrag.fromEquipSlot) {
          inventory.equipItem(_invDrag.fromEquipSlot, _invDrag.typeId);
        }
      }
      _invDrag = null;
      state.renderInventoryCraftingUI();
      state.updateHotbarUI();
      return;
    }

    // ── Simple click (no drag) ──
    if (dist <= 5 && e.button === 0) {
      // Click on equipment slot → unequip into the inventory.
      //
      // **D-52.** PR 17 carried this branch across verbatim knowing it was dead:
      // `_invClickStart` had been nulled above, so the guard was permanently false.
      // It reads the captured `fromEquip` now and is live. It fails *safe* at a full
      // inventory — `addItem` reporting `remaining > 0` re-equips rather than
      // destroying the item — and the `return` below is also what keeps the
      // inventory-slot branch from calling `getSlot(undefined)`, which was the other
      // half of the old behaviour: `getSlot` tests `index < 0 || index >= totalSlots`,
      // both false for `undefined`, and quietly returned `this.slots[undefined]`.
      if (fromEquip) {
        const equipSlotName = fromEquip;
        const item = inventory.unequipItem(equipSlotName);
        if (item) {
          const result = inventory.addItem(item.typeId, item.count);
          if (result.remaining > 0) {
            // Inventory full — re-equip
            inventory.equipItem(equipSlotName, item.typeId);
          }
        }
        state.renderInventoryCraftingUI();
        state.updateHotbarUI();
        return;
      }

      // Click on inventory slot
      const fromSlot = inventory.getSlot(fromIdx);
      const isHotbar = inventory.isHotbarSlot(fromIdx);
      if (fromSlot) {
        // Quick-equip armor: if item is equippable and target equipment slot is empty, equip directly
        if (inventory.isEquippable(fromSlot.typeId)) {
          const equipSlot = inventory.getEquipmentSlot(fromSlot.typeId);
          if (equipSlot && !inventory.getEquippedItem(equipSlot)) {
            inventory.setSlot(fromIdx, null);
            inventory.equipItem(equipSlot, fromSlot.typeId);
            state.renderInventoryCraftingUI();
            state.updateHotbarUI();
            return;
          }
        }

        if (!isHotbar) {
          const hotbarIdx = inventory.hotbarSlotIndex(inventory.selectedHotbarSlot);
          const hotbarSlot = inventory.getSlot(hotbarIdx);
          if (!hotbarSlot) {
            inventory.setSlot(hotbarIdx, { typeId: fromSlot.typeId, count: fromSlot.count });
            inventory.clearSlot(fromIdx);
          } else if (inventory.itemsMatch(hotbarSlot.typeId, fromSlot.typeId)) {
            const maxStack = inventory.getMaxStack(fromSlot.typeId);
            const space = maxStack - hotbarSlot.count;
            if (space > 0) {
              const move = Math.min(space, fromSlot.count);
              hotbarSlot.count += move;
              fromSlot.count -= move;
              if (fromSlot.count <= 0) inventory.clearSlot(fromIdx);
              inventory._notifySlotChange(hotbarIdx);
            }
          } else {
            inventory.swapSlots(fromIdx, hotbarIdx);
          }
        } else {
          inventory.selectHotbarSlot(fromIdx - inventory.hotbarStart);
        }
        state.renderInventoryCraftingUI();
        state.updateHotbarUI();
      }
    }
  };
  document.addEventListener('mouseup', invMouseUp);
  state.addTeardown(() => document.removeEventListener('mouseup', invMouseUp));
}
