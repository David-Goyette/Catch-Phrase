import {initializeApp} from 'https://www.gstatic.com/firebasejs/9.19.1/firebase-app.js';
import {getFirestore, doc, collection, getDoc, getDocs, setDoc, onSnapshot} from 'https://www.gstatic.com/firebasejs/9.19.1/firebase-firestore.js';

const firebaseConfig = {
    apiKey: "AIzaSyAMrgoQECJcnYBZG8dfEnBZeWTZlBIBcGk",
    authDomain: "catch-phrase-live.firebaseapp.com",
    projectId: "catch-phrase-live",
    storageBucket: "catch-phrase-live.firebasestorage.app",
    messagingSenderId: "701003910296",
    appId: "1:701003910296:web:43ce981f6e8fad7b2214ed"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const servers = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
    ],
    iceCandidatePoolSize: 10,
};

let joinButton = document.querySelector('#join-button');
let createButton = document.querySelector('#create-button');
let generateButton = document.querySelector('#generate-button');
let startButton = document.querySelector('#start-button');
let goButton = document.querySelector('#go-button');
let skipButton = document.querySelector('#skip-button');
let nextButton = document.querySelector('#next-button');
let leaveButton = document.querySelector('#leave-button');
let setupButton = document.querySelector('#setup-button');

let playerInput = document.querySelector('#player-input');
let roomInput = document.querySelector('#room-input');
let categoriesInput = document.querySelector('#categories-input');

let boxIcon = document.querySelector('i');
let invalidAlert = document.querySelector('#invalid-alert');
let roomName = document.querySelector('#room-name');
let mainVideo = document.querySelector('#main-video');
let scoreBoard = document.querySelector('#score-board');

let name;
let localStream;
let roomRef;
let peerConnections = {};
let phraseList;
let myTeam = {};
let opTeam = {};
let counter;
let recognition;
let time;
let phrase;
let turnHolder;

//listeners

joinButton.addEventListener('click', validateJoinRoom);
createButton.addEventListener('click', validateCreateRoom);
generateButton.addEventListener('click', getCategories);
startButton.addEventListener('click', startGame);
goButton.addEventListener('click', () => sendTurnInfo('go'));
skipButton.addEventListener('click', () => {
    phrase = phraseList[phraseList.indexOf(phrase) +1];
    sendTurnInfo('skip');
});
nextButton.addEventListener('click', () => sendTurnInfo('next'));
setupButton.addEventListener('click', () => {
    phraseList = [];
    loadSetupBox();
});
leaveButton.addEventListener('click', () => location.reload());

function listenDirect(){
    onSnapshot(doc(roomRef, `players/${name}`), snapshot => {
        let data = snapshot.data();
        if(data){
            if(data.offer) sendAnswer(data.offer);
            else if(data.answer) addAnswer(data.answer);
            else if(data.nextTurn) sendTurnInfo('next');
        }
    });
}

function listenGlobal(){
    onSnapshot(doc(roomRef, 'game/updates'), snapshot => {
        let data = snapshot.data();
        if(data){
            if(data.gameInfo) setGameInfo(data.gameInfo);
            else if(data.turnInfo) setTurnInfo(data.turnInfo);
        }
    });
}

//video chat functions

async function validateCreateRoom(){
    name = playerInput.value;
    let room = roomInput.value;
    if(!name || /[^A-Za-z0-9-_]/.test(name) || name.length > 10) return
    if(!room || /[^A-Za-z0-9-_]/.test(room) || room.length > 16) return
    roomRef = doc(db, `rooms/${room}`);
    if((await getDoc(roomRef)).exists()){
        invalidAlert.textContent = '! This room name is unavailable.'
        invalidAlert.style = 'display: flex';
        return
    }
    localStream = await navigator.mediaDevices.getUserMedia({video: true, audio: true});
    if(!localStream){
        invalidAlert.textContent = '! A video camera connection is required to play.'
        invalidAlert.style = 'display: flex';
        return
    }
    else createRoom(room);
}

async function validateJoinRoom(){
    name = playerInput.value;
    let room = roomInput.value;
    if(!name || /[^A-Za-z0-9-_]/.test(name) || name.length > 10) return
    if(!room || /[^A-Za-z0-9-_]/.test(room) || room.length > 16) return
    roomRef = doc(db, `rooms/${room}`);
    if(!(await getDoc(roomRef)).exists()){
        invalidAlert.textContent = '! This room does not exist.'
        invalidAlert.style = 'display: flex';
        return
    }
    if((await getDoc(doc(roomRef, 'game/updates'))).exists()){
        invalidAlert.textContent = '! This room is unavailable.'
        invalidAlert.style = 'display: flex';
        return
    }
    if((await getDoc(doc(roomRef, `players/${name}`))).exists()){
        invalidAlert.textContent = '! This name is unavailable.'
        invalidAlert.style = 'display: flex';
        return
    }
    localStream = await navigator.mediaDevices.getUserMedia({video: true, audio: true});
    if(!localStream){
        invalidAlert.textContent = '! A video camera connection is required to play.'
        invalidAlert.style = 'display: flex';
        return
    }
    else joinRoom(room);
}

async function createRoom(room){
    roomName.textContent = room;
    roomName.style = 'display: flex';
    addVideo(localStream, name, true);
    loadSetupBox();
    
    setDoc(roomRef, {});
    setDoc(doc(roomRef, `players/${name}`), {});

    listenDirect();
    listenGlobal();
}

async function joinRoom(room){
    roomName.textContent = room;
    roomName.style = 'display: flex';
    addVideo(localStream, name, true);
    mainVideo.srcObject = localStream;
    loadIdleBox('Waiting for the host to start the game.');

    let players = await getDocs(collection(roomRef, 'players'));
    setDoc(doc(roomRef, `players/${name}`), {});
        
    listenDirect();
    listenGlobal();
    sendOffers(players);
}

function sendOffers(players){
    players.forEach(async player => {
        let playerName = player.id;
        peerConnections[playerName] = new RTCPeerConnection(servers);
        let remoteStream = new MediaStream();
        
        addTracks(peerConnections[playerName], remoteStream, playerName);

        let offer = await createOffer(peerConnections[playerName]);
        setDoc(doc(roomRef, `players/${playerName}`), {offer: {[name]: offer}});
        addVideo(remoteStream, playerName, false);
    });
}

async function sendAnswer(offerJSON){
    let playerName = Object.keys(offerJSON)[0];
    peerConnections[playerName] = new RTCPeerConnection(servers);
    let remoteStream = new MediaStream();
    
    addTracks(peerConnections[playerName], remoteStream, playerName);
    
    let offer = JSON.parse(Object.values(offerJSON)[0]);
    let answer = await createAnswer(peerConnections[playerName], offer);
    
    setDoc(doc(roomRef, `players/${playerName}`), {answer: {[name]: answer}});
    addVideo(remoteStream, playerName, false);
}

function addTracks(peerConnection, stream, playerName){
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    peerConnection.ontrack = event => {
        event.streams[0].getTracks().forEach(track => {
            stream.addTrack(track);
        });
    }

    peerConnection.onconnectionstatechange = () => {
        if(peerConnection.connectionState === 'failed') removePlayer(playerName);
    }
}

function removePlayer(playerName){
    document.querySelector(`button[name="${playerName}"]`).remove();
    document.querySelector(`.video-wrapper[name="${playerName}"]`).remove();
    validateGameInput();
    adaptVideoGrid();
    if(myTeam.players.includes(playerName)){
        myTeam.players.splice(myTeam.players.indexOf(playerName), 1);
        console.log(myTeam.players);
    }
    else if(opTeam.players.includes(playerName)){
        opTeam.players.splice(opTeam.players.indexOf(playerName), 1);
        console.log(opTeam.players);
        if(playerName === turnHolder) sendTurnInfo('next');
    }
}

function addAnswer(answerJSON){
    let player = Object.keys(answerJSON)[0];
    let answer = JSON.parse(Object.values(answerJSON)[0]);
    if(!peerConnections[player].currentRemoteDescription){
        peerConnections[player].setRemoteDescription(answer);
    }
}

async function createOffer(peerConnection){
    let offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    await new Promise(resume => setTimeout(resume, 250));
    return JSON.stringify(peerConnection.localDescription);
}

async function createAnswer(peerConnection, offer){
    await peerConnection.setRemoteDescription(offer);
    let answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    await new Promise(resume => setTimeout(resume, 250));
    return JSON.stringify(peerConnection.localDescription);
}

//game-play functions

async function getCategories(){
    let categories = 'everyday life, fun and games';
    for(let word of categoriesInput.value.split(/[^a-zA-Z]+/)){
        try{
            let response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${word}`);
            if(response.ok) categories += `, ${word}`;
        }
        catch(error){
            console.error(error);
        }
    }
    generateList(categories);
}

async function generateList(categories){
    let prompt = `Generate a list of 200 sayings and idioms (1-4 words long each). Make the idioms/sayings interesting but well known and relating to these categories: ${categories}. Please shuffle the items in the list and use lowercase letters and apostrophes when needed. It is crucial that you return only the list in this exact format: phrase|phrase|phrase.`;
    let apiKey = 'AIzaSyAWDZzjl8AGL9ZVjX_2FPg7zTssu5vBPrE';
    let options = {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            contents: [{
                parts: [{
                    text: prompt
                }]
            }]
        })
    };
    
    try{
        let response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, options);
        if(!response.ok) throw new Error('API response error from Gemini AI');
        let data = await response.json();
        phraseList = data.candidates[0].content.parts[0].text.split('|');
        validateGameInput();
    }catch(error){
        console.error(error);
    }
}

async function startGame(){
    let greenTeam = [...document.querySelectorAll('button.greenTeam')].map(playerButton => playerButton.textContent);
    let redTeam = [...document.querySelectorAll('button.redTeam')].map(playerButton => playerButton.textContent);
    let gameInfo = {
        phraseList: phraseList,
        greenTeam: greenTeam,
        redTeam: redTeam
    }
    let turnInfo = {
        turnHolder: name,
        time: 0,
        phrase: phraseList[0],
        score: {greenTeam: 0, redTeam: 0}
    }

    setDoc(doc(roomRef, 'game/updates'), {gameInfo: gameInfo});
    setDoc(doc(roomRef, 'game/updates'), {turnInfo: turnInfo});
}

function setGameInfo(info){
    let greenTeam = info.greenTeam;
    let redTeam = info.redTeam;
    phraseList = info.phraseList;
    if(greenTeam.includes(name)){
        myTeam.name = 'greenTeam';
        myTeam.players = greenTeam;
        opTeam.name = 'redTeam';
        opTeam.players = redTeam;
    }
    else if(redTeam.includes(name)){
        myTeam.name = 'redTeam';
        myTeam.players = redTeam;
        opTeam.name = 'greenTeam';
        opTeam.players = greenTeam;
    }
    scoreBoard.style = 'display: flex';
    colorLabels();
}

function setTurnInfo(info){
    clearInterval(counter);
    if(recognition) recognition.abort();
    
    turnHolder = info.turnHolder;
    time = info.time;
    phrase = info.phrase;
    myTeam.score = info.score[myTeam.name];
    opTeam.score = info.score[opTeam.name];
    
    updateScoreBoard(info.score);
    mainVideo.srcObject = document.querySelector(`video[name="${turnHolder}"]`).srcObject;
    defineAction();
}

function defineAction(){
    let myTurn = (turnHolder === name);
    if(time > 0){
        if(myTurn) takeTurn();
        else detectGuess();
    }
    else{
        boxIcon.className = 'bx bx-hourglass bx-md';
        if(myTeam.score > 6) loadEndBox('Victory!');
        else if(opTeam.score > 6) loadEndBox('Defeat.');
        else if(myTurn) loadGoBox('Press Go to start your turn.');
        else loadIdleBox(`Waiting for ${turnHolder} to press Go.`);
    }
}

function takeTurn(){
    loadTurnBox();
    counter = setInterval(() => countDown('myTurn'), 1000);
}

function detectGuess(){
    loadIdleBox(`${turnHolder}'s turn`);
    counter = setInterval(() => countDown(), 1000);
    let autoRestart = true;
    recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.addEventListener('result', event => {
        console.log(event.results[event.results.length - 1][0].transcript.toLowerCase());
        if(event.results[event.results.length - 1][0].transcript.toLowerCase().includes(phrase)){
            setDoc(doc(roomRef, `players/${turnHolder}`), {nextTurn: phrase});
        }
    });
    recognition.onerror = () => {
        autoRestart = false;
        recognition.stop();
    }
    recognition.onend = () => {if(autoRestart) recognition.start()};
    recognition.start();
}

function sendTurnInfo(action){
    let turnInfo = {
        turnHolder: (action === 'next') ? opTeam.players[Math.floor(opTeam.players.length * Math.random())] : name,
        time: (action === 'go') ? 60 + Math.floor(46 * Math.random()) : time,
        phrase: (action === 'go') ? phrase : phraseList[phraseList.indexOf(phrase) +1],
        score: {[myTeam.name]: myTeam.score, [opTeam.name]: opTeam.score}
    }
    console.log(turnInfo);
    setDoc(doc(roomRef, 'game/updates'), {turnInfo: turnInfo});
}

function countDown(myTurn){
    time -= 1;
    if(time > 35) boxIcon.className = 'bx bxs-hourglass-top bx-md';
    else if(time === 35) boxIcon.className = 'bx bxs-hourglass bx-md';
    else if(time === 15) boxIcon.className = 'bx bxs-hourglass-bottom bx-md';
    else if(time <= 0 && myTurn){
        clearInterval(counter);
        opTeam.score += 1;
        sendTurnInfo('next');
    } 
}

//HTML change functions

let boxes = document.querySelectorAll('.box');
let mainVideoWrapper = document.querySelector('#main-video-wrapper');

function loadSetupBox(){
    startButton.disabled = true;
    boxes.forEach(box => {box.style.display = 'none'});
    mainVideoWrapper.style.display = 'none';
    document.querySelector('#setup-box').style.display = 'flex';
}

function loadIdleBox(message){
    boxes.forEach(box => {box.style.display = 'none'});
    mainVideoWrapper.style.display = 'block';
    let idleBox = document.querySelector('#idle-box');
    idleBox.style.display = 'flex';
    idleBox.querySelector('.message').textContent = message;
}

function loadTurnBox(){
    boxes.forEach(box => {box.style.display = 'none'});
    mainVideoWrapper.style.display = 'block';
    let turnBox = document.querySelector('#turn-box');
    turnBox.style.display = 'flex';
    turnBox.querySelector('.message').textContent = phrase;
}

function loadGoBox(message){
    boxes.forEach(box => {box.style.display = 'none'});
    mainVideoWrapper.style.display = 'block';
    let goBox = document.querySelector('#go-box');
    goBox.style.display = 'flex';
    goBox.querySelector('.message').textContent = message;
}

function loadEndBox(message){
    boxes.forEach(box => {box.style.display = 'none'});
    mainVideoWrapper.style.display = 'none';
    let endBox = document.querySelector('#end-box');
    endBox.style.display = 'flex';
    endBox.querySelector('.message').textContent = message;
    if(message === 'Victory!'){
        let winningColor = window.getComputedStyle(document.querySelector(`.${myTeam.name}`)).backgroundColor;
        setTimeout(() => shoot(winningColor), 0);
        setTimeout(() => shoot(winningColor), 100);
        setTimeout(() => shoot(winningColor), 200);
    }
}

function addVideo(stream, name, muted){
    let videoWrapper = document.createElement('div');
    let videoLabel = document.createElement('label');
    let video = document.createElement('video');
    
    videoWrapper.className = 'video-wrapper';
    videoLabel.className = 'video-label';
    videoLabel.textContent = name;
    video.srcObject = stream;
    video.setAttribute('name', name);
    videoWrapper.setAttribute('name', name);
    video.autoplay = true;
    video.playsInline = true;
    video.muted = muted;

    document.getElementById('video-grid').append(videoWrapper);
    videoWrapper.append(video);
    videoWrapper.append(videoLabel);

    adaptVideoGrid()
    addPlayerButton(name);
}

function adaptVideoGrid(){
    let videoWrappers = document.querySelectorAll('.video-wrapper');
    if(videoWrappers.length < 2) document.body.style.setProperty('--video-wrapper-size', '600px');
    else if(videoWrappers.length < 5) document.body.style.setProperty('--video-wrapper-size', '300px');
    else if(videoWrappers.length < 10) document.body.style.setProperty('--video-wrapper-size', '200px');
    else document.body.style.setProperty('--video-wrapper-size', '150px');
}

function addPlayerButton(name){
    let playerButton = document.createElement('button');
    playerButton.textContent = name;
    playerButton.className = 'button-style-1';
    playerButton.setAttribute('name', name);
    document.querySelector('#player-button-grid').append(playerButton);
    validateGameInput();
    playerButton.addEventListener('click', () => {
        if(playerButton.className === 'greenTeam') playerButton.className = 'redTeam';
        else playerButton.className = 'greenTeam';
        validateGameInput();
    });
}

function colorLabels(){
    let labels = document.querySelectorAll('.video-label');
    for(let label of labels){
        if(myTeam.players.includes(label.textContent)) label.className = `video-label ${myTeam.name}`;
        else if(opTeam.players.includes(label.textContent)) label.className = `video-label ${opTeam.name}`;
    }
}

function updateScoreBoard(info){
    scoreBoard.querySelector('.greenTeam').textContent = info.greenTeam;
    scoreBoard.querySelector('.redTeam').textContent = info.redTeam;
}

//input element validation

playerInput.addEventListener('input', () => {
    let value = playerInput.value.replace(/[^A-Za-z0-9-_]/g, '').slice(0, 10);
    playerInput.value = value;
});

roomInput.addEventListener('input', () => {
    let value = roomInput.value.replace(/[^A-Za-z0-9-_]/g, '').slice(0, 16);
    roomInput.value = value;
});

function validateGameInput(){
    let noTeam = document.querySelector('#player-button-grid > button.button-style-1');
    let greenTeam = document.querySelectorAll('button.greenTeam');
    let redTeam = document.querySelectorAll('button.redTeam');
    if(!noTeam && phraseList && greenTeam.length > 1 && redTeam.length > 1) startButton.disabled = false;
    else startButton.disabled = true;
}

// fun animation for game end

let defaults = {
    spread: 360,
    ticks: 50,
    gravity: 0,
    decay: 0.94,
    startVelocity: 30,
    shapes: ["star"]
};
  
function shoot(winningColor) {
    confetti({
      ...defaults,
      colors: [winningColor],
      particleCount: 50,
      scalar: 0.75,
      shapes: ["star"],
    });
}

    





