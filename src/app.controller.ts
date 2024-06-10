import { Body, Controller, Get, Post, Render, Res } from '@nestjs/common';
import { AppService } from './app.service';
import { Response } from 'express';
import { CreateSymbolDto } from './dto/create-symbol.dto';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}
  
  @Get()
  @Render('index')
  getHome() { }

  @Post('submit')
  async handleHomeForm(@Body() body: CreateSymbolDto, @Res() res: Response) {
    await this.appService.createSymbol(body);
    
    res.redirect('/');
  }

  @Post('restart-timeouts')
  async restartTimeouts(@Res() res: Response) {
    await this.appService.restartTimeouts();
    
    res.redirect('/');
  }
}
