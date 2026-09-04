from setuptools import setup, find_packages

setup(
    name="webrtc-healing",
    version="0.1.0",
    description="自愈定位引擎 — 7 策略元素定位 & 步骤执行",
    packages=find_packages(include=["webrtc_healing", "webrtc_healing.*"]),
    python_requires=">=3.9",
    license="AGPL-3.0-or-later",
    install_requires=[
        "playwright",
        "pytest",
        "allure-pytest",
        "requests",
    ],
)
