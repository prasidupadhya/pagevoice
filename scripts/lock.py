"""Record the installed core/API/test dependency closure (not optional ML engines)."""
from importlib.metadata import distribution
from pathlib import Path
from packaging.requirements import Requirement
import tomli

project=tomli.loads(Path('pyproject.toml').read_text())['project']
pending=project['dependencies']+project['optional-dependencies']['test']+project['optional-dependencies']['api']
versions={}
while pending:
    requirement=Requirement(pending.pop())
    if requirement.marker and not requirement.marker.evaluate({'extra':''}):
        continue
    package=distribution(requirement.name)
    name=package.metadata['Name']
    if name in versions:continue
    versions[name]=package.version
    pending.extend(package.requires or [])
Path('requirements-core.lock').write_text(''.join(f'{name}=={version}\n' for name,version in sorted(versions.items(),key=lambda p:p[0].lower())))
