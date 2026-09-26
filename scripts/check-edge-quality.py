"""Explicit online smoke/diagnostic: original EN/ES prose, no user book text.
Run .venv/bin/python scripts/check-edge-quality.py --allow-network
"""
import argparse
import json
import subprocess
import tempfile
import time
import wave
from pathlib import Path
from pagevoice.engines import create,builtin_voices
from pagevoice.narration import synthesize
from pagevoice.audio import normalize,frames,RATE

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--allow-network',action='store_true')
args=parser.parse_args()
if not args.allow_network:parser.error('Pass --allow-network to send the original test sentences to Microsoft.')
samples={
 'en':'The reader followed the narrow path beside the harbour, watching the morning light move across the water while the fishermen prepared their boats and the first passengers gathered quietly near the wooden bridge, ready for a journey that would take them beyond the island before the end of the day.',
 'es':'La lectora siguió el sendero junto al puerto, observando cómo la luz de la mañana se extendía sobre el agua mientras los pescadores preparaban sus barcos y los primeros pasajeros se reunían tranquilamente cerca del puente de madera, dispuestos a emprender un viaje que los llevaría más allá de la isla antes de que terminara el día.'}
class Meter:
 max_text_bytes=3500
 def __init__(self):self.adapter=create('edge',allow_network=True);self.calls=[]
 def synthesize(self,text,path,voice,language):self.calls.append(text);self.adapter.synthesize(text,path,voice,language)
with tempfile.TemporaryDirectory(prefix='pagevoice-edge-quality-') as folder:
 folder=Path(folder);report=[]
 for voice in builtin_voices('edge'):
  text=samples[voice['language']];engine=Meter();start=time.monotonic()
  raw=folder/'speech.raw';wav=folder/'speech.wav'
  synthesize(engine,text,raw,voice['id'],voice['language']);normalize(raw,wav)
  assert engine.calls==[text], 'A natural sentence was split into multiple requests'
  result=subprocess.run(['ffmpeg','-hide_banner','-i',str(wav),'-af','silencedetect=noise=-45dB:d=0.4','-f','null','-'],capture_output=True,text=True,check=True)
  intervals=[line.split('] ',1)[-1] for line in result.stderr.splitlines() if 'silence_' in line]
  row={'voice':voice['id'],'characters':len(text),'requests':len(engine.calls),'seconds_to_audio':round(time.monotonic()-start,2),'audio_seconds':round(frames(wav)/RATE,2),'silence_diagnostics':intervals}
  report.append(row);print(json.dumps(row,ensure_ascii=False),flush=True)
 print(json.dumps({'voices_verified':len(report),'languages':list(samples)},ensure_ascii=False))
