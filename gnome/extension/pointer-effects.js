import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {lensGeometry} from './pointer-state.js';

// Clip the live desktop clone to a circular lens. CSS border-radius alone
// does not clip Clutter children. The shader runs only on the lens texture.
const CircularLensEffect = GObject.registerClass(
class CircularLensEffect extends Clutter.ShaderEffect {
    _init() {
        super._init({shader_type: Cogl.ShaderType.FRAGMENT});
        this.set_shader_source(`
            uniform sampler2D tex;
            uniform float edge;
            void main() {
                vec2 uv = cogl_tex_coord_in[0].st;
                float radius = length(uv - vec2(0.5));
                float mask = 1.0 - smoothstep(0.5 - edge, 0.5, radius);
                cogl_color_out = texture2D(tex, uv) * cogl_color_in * mask;
            }
        `);
        this.set_uniform_value('tex', 0);
        this.set_uniform_value('edge', 0.005);
    }
});

export class PointerEffects {
    constructor() {
        this.actor = new St.Widget({reactive: false, visible: false});
        // The effects are stage siblings of Main.uiGroup, so the live clone
        // cannot recursively include the lens or the darkening overlay.
        global.stage.add_child(this.actor);
        Shell.util_set_hidden_from_pick(this.actor, true);
        this._shade = new St.DrawingArea({reactive: false, visible: false});
        this.actor.add_child(this._shade);
        this._shade.connect('repaint', area => {
            const cr = area.get_context();
            const [width, height] = area.get_surface_size();
            cr.setFillRule(Cairo.FillRule.EVEN_ODD);
            cr.rectangle(0, 0, width, height);
            cr.arc(this._x, this._y, this._radius, 0, 2 * Math.PI);
            cr.setSourceRGBA(0, 0, 0, this._opacity);
            cr.fill();
            cr.$dispose();
        });
        this._lens = new Clutter.Actor({clip_to_allocation: true, visible: false});
        this._circle = new CircularLensEffect();
        this._lens.add_effect(this._circle);
        this.actor.add_child(this._lens);
        // Mirror GNOME's magnifier source, without activating or changing it.
        this._clone = new Clutter.Clone({source: Main.uiGroup});
        this._lens.add_child(this._clone);
        this._rim = new St.Widget({reactive: false, visible: false,
            style: 'border: 2px solid rgba(255,255,255,0.9); border-radius: 999px;'});
        this.actor.add_child(this._rim);
    }

    update(active, mode, x, y, settings) {
        this.actor.set_size(global.stage.width, global.stage.height);
        this.actor.visible = active && mode !== 'laser';
        this._shade.visible = active && mode === 'spotlight';
        this._lens.visible = active && mode === 'magnifier';
        this._rim.visible = this._lens.visible;
        if (!this.actor.visible) return;
        global.stage.set_child_above_sibling(this.actor, null);
        if (mode === 'spotlight') {
            this._x = x;
            this._y = y;
            this._radius = settings.get_int('spotlight-size') / 2;
            this._opacity = settings.get_double('spotlight-dim');
            this._shade.set_size(global.stage.width, global.stage.height);
            this._shade.queue_repaint();
        } else {
            const monitor = Main.layoutManager.monitors.find(m =>
                x >= m.x && x < m.x + m.width && y >= m.y && y < m.y + m.height) ??
                {x: 0, y: 0, width: global.stage.width, height: global.stage.height};
            const factor = settings.get_double('magnifier-factor');
            const g = lensGeometry(x, y, settings.get_int('magnifier-size'), factor, monitor);
            this._lens.set_position(g.left, g.top);
            this._lens.set_size(g.size, g.size);
            this._circle.set_uniform_value('edge', 1 / g.size);
            this._clone.set_position(g.sourceX, g.sourceY);
            this._clone.set_scale(factor, factor);
            this._rim.set_position(g.left, g.top);
            this._rim.set_size(g.size, g.size);
        }
    }

    destroy() {
        this.actor.destroy();
    }
}
