#version 300 es
// SPDX-License-Identifier: GPL-3.0-or-later
precision highp float;
precision highp int;
uniform sampler2D uTex;
uniform ivec2 uOffset;
layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outBlue;
void main() {
  vec4 p = texelFetch(uTex, ivec2(gl_FragCoord.xy) - uOffset, 0);
  outColor = p;
  outBlue = vec4(p.ba, 0.0, 1.0);
}
