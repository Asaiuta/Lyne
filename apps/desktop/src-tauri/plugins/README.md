# Bundled Integration Plugins

This directory contains first-party integration packages shipped with Lyne.
Each package is a child directory with a strict plugin.json manifest and a
package-relative runner entrypoint. Phase-one packages use the host newline
delimited JSON protocol and capability broker.

The VCPToolBox package will be added by the distributed-node plugin task.
