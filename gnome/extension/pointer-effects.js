import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GLib from 'gi://GLib';
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
            uniform float quality;
            uniform float sampleStep;
            uniform float blockStep;
            uniform float originX;
            uniform float originY;
            void main() {
                vec2 uv = cogl_tex_coord_in[0].st;
                float radius = length(uv - vec2(0.5));
                float mask = 1.0 - smoothstep(0.5 - edge, 0.5, radius);
                vec2 sampleUV = uv;
                if (quality > 1.5) {
                    vec2 origin = vec2(originX, originY);
                    sampleUV = (floor((uv - origin) / blockStep) + 0.5) * blockStep + origin;
                    sampleUV = clamp(sampleUV, vec2(sampleStep * 0.5), vec2(1.0 - sampleStep * 0.5));
                }
                vec4 color = texture2D(tex, sampleUV);
                if (quality > 0.5 && quality < 1.5) {
                    vec3 average = (texture2D(tex, uv + vec2(sampleStep, 0.0)).rgb
                        + texture2D(tex, uv - vec2(sampleStep, 0.0)).rgb
                        + texture2D(tex, uv + vec2(0.0, sampleStep)).rgb
                        + texture2D(tex, uv - vec2(0.0, sampleStep)).rgb) * 0.25;
                    color.rgb = clamp(color.rgb + clamp((color.rgb - average) * 0.4, vec3(-0.08), vec3(0.08)), 0.0, 1.0);
                }
                cogl_color_out = color * cogl_color_in * mask;
            }
        `);
        this.set_uniform_value('tex', 0);
        this.set_uniform_value('edge', 0.005);
        for (const [key, value] of [['quality', 0.0], ['sampleStep', 0.003], ['blockStep', 0.006], ['originX', 0.0], ['originY', 0.0]]) this.set_uniform_value(key, value);
    }
});

function rgba(text, fallback) {
    const [valid, color] = Cogl.Color.from_string(text);
    return valid ? [color.red / 255, color.green / 255, color.blue / 255] : fallback;
}

function shapePath(cr, x, y, radius, shape, rotation) {
    cr.save();
    cr.translate(x, y);
    cr.rotate(rotation * Math.PI / 180);
    if (shape === 'square') cr.rectangle(-radius, -radius, radius * 2, radius * 2);
    else if (shape === 'diamond') {
        cr.moveTo(0, -radius); cr.lineTo(radius, 0); cr.lineTo(0, radius); cr.lineTo(-radius, 0); cr.closePath();
    } else cr.arc(0, 0, radius, 0, 2 * Math.PI);
    cr.restore();
}

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
            shapePath(cr, this._x, this._y, this._radius, this._shape, this._rotation);
            cr.setSourceRGBA(...this._shadeColor, this._opacity);
            cr.fill();
            if (this._borderWidth > 0) {
                shapePath(cr, this._x, this._y, this._radius, this._shape, this._rotation);
                cr.setSourceRGBA(...this._borderColor, 1);
                cr.setLineWidth(this._borderWidth);
                cr.stroke();
            }
            cr.$dispose();
        });
        this._trailPoints = [];
        this._trail = new St.DrawingArea({reactive: false, visible: false});
        this.actor.add_child(this._trail);
        this._trail.connect('repaint', area => {
            const cr = area.get_context();
            const now = GLib.get_monotonic_time();
            for (const point of this._trailPoints) {
                const alpha = Math.max(0, 1 - (now - point.time) / this._trailLifetime);
                cr.arc(point.x, point.y, this._trailRadius * (0.3 + alpha * 0.5), 0, Math.PI * 2);
                cr.setSourceRGBA(...this._trailColor, alpha * 0.6);
                cr.fill();
            }
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
        const trail = active && settings.get_boolean('trail-enabled');
        this.actor.visible = active && (mode !== 'laser' || trail);
        this._updateTrail(trail, x, y, settings);
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
            this._shape = settings.get_string('spotlight-shape');
            this._rotation = settings.get_int('spotlight-rotation');
            this._shadeColor = rgba(settings.get_string('spotlight-color'), [0, 0, 0]);
            this._borderColor = rgba(settings.get_string('spotlight-border-color'), [1, 1, 1]);
            this._borderWidth = settings.get_int('spotlight-border-width');
            this._shade.set_size(global.stage.width, global.stage.height);
            this._shade.queue_repaint();
        } else if (mode === 'magnifier') {
            const monitor = Main.layoutManager.monitors.find(m =>
                x >= m.x && x < m.x + m.width && y >= m.y && y < m.y + m.height) ??
                {x: 0, y: 0, width: global.stage.width, height: global.stage.height};
            const factor = settings.get_double('magnifier-factor');
            const g = lensGeometry(x, y, settings.get_int('magnifier-size'), factor, monitor);
            this._lens.set_position(g.left, g.top);
            this._lens.set_size(g.size, g.size);
            this._circle.set_uniform_value('edge', 1 / g.size);
            const quality = settings.get_string('magnifier-quality');
            this._circle.set_uniform_value('quality', quality === 'text' ? 1.0 : quality === 'pixel' ? 2.0 : 0.0);
            this._circle.set_uniform_value('sampleStep', 1 / g.size);
            this._circle.set_uniform_value('blockStep', factor / g.size);
            this._circle.set_uniform_value('originX', g.sourceX / g.size);
            this._circle.set_uniform_value('originY', g.sourceY / g.size);
            this._clone.set_position(g.sourceX, g.sourceY);
            this._clone.set_scale(factor, factor);
            this._rim.set_position(g.left, g.top);
            this._rim.set_size(g.size, g.size);
        }
    }

    _updateTrail(active, x, y, settings) {
        this._trail.visible = active;
        if (!active) {
            this._trailPoints = [];
            if (this._trailTimer) GLib.source_remove(this._trailTimer);
            this._trailTimer = 0;
            return;
        }
        this._trail.set_size(global.stage.width, global.stage.height);
        this._trailColor = rgba(settings.get_string('dot-color'), [1, 0.1, 0.1]);
        this._trailRadius = settings.get_int('dot-size') / 2;
        this._trailLifetime = settings.get_double('trail-seconds') * 1000000;
        const now = GLib.get_monotonic_time();
        const last = this._trailPoints.at(-1);
        if (!last || ((last.x !== x || last.y !== y) && now - last.time >= 16000)) {
            this._trailPoints.push({x, y, time: now});
            if (this._trailPoints.length > 128) this._trailPoints.shift();
        }
        if (!this._trailTimer) this._trailTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 33, () => {
            const now = GLib.get_monotonic_time();
            this._trailPoints = this._trailPoints.filter(point => now - point.time < this._trailLifetime);
            this._trail.queue_repaint();
            if (!this._trailPoints.length) { this._trailTimer = 0; return GLib.SOURCE_REMOVE; }
            return GLib.SOURCE_CONTINUE;
        });
        this._trail.queue_repaint();
    }

    destroy() {
        if (this._trailTimer) GLib.source_remove(this._trailTimer);
        this._trailTimer = 0;
        this.actor.destroy();
    }
}
